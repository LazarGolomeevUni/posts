const express = require('express');
const jwt = require('jsonwebtoken');
const { createPool } = require("mysql");
const amqp = require('amqplib/callback_api');

const app = express();

app.use(express.json())

//RabbitMQ
const StatusEnum = {
    PENDING: 'pending',
    APPROVED: 'approved',
    DENIED: 'denied'
};

let consumedChannel = '';
let qu;

//MySQL connection
//This one is for local env
// const pool = createPool({
//     host: "localhost",
//     user: "root",
//     password: "password"
// })

//MySQL connection
//This one is for cloud env
const pool = createPool({
    host: "thelibraryclub.cwahxov3y8ow.eu-north-1.rds.amazonaws.com",
    user: "lazar",
    password: "thelibraryclub"
})

//GET all posts
app.get('/all', (req, res) => {
    pool.query(`select * from postsdb.posts where status="approved"`, (err, result) => {
        if (err) {
            console.log(err);
        }
        else {
            posts = result;

            res.json(posts);
        }
    })
})

//GET posts of particular user
app.get("/everything", (req, res) => {
    const user = JSON.parse(req.headers['user']);
    pool.query(`select * from postsdb.posts where userId=${user.id}`, (err, result) => {
        if (err) {
            console.log(err);
        }
        else {
            posts = result;

            res.json(posts);
        }
    })

});

//GET post for moderation
app.get("/moderationPost", (req, res) => {
    pool.query(`select * from postsdb.posts where id=${req.body.id}`, (err, result) => {
        if (err) {
            console.log(err);
        }
        else {
            posts = result;

            res.json(posts);
        }
    })

});

//Messaging waits to receive data and updates db
amqp.connect('amqps://rsaictxm:WL_JjhXfSmLKSyTKQDlLGxKhCr70pbFv@rat.rmq2.cloudamqp.com/rsaictxm',
    function (error0, connection) {
        if (error0) {
            throw error0;
        }
        connection.createChannel(function (error1, channel) {
            if (error1) {
                throw error1;
            }
            consumedChannel = channel;
            channel.assertQueue('', {
                exclusive: true
            }, function (error2, q) {
                if (error2) {
                    throw error2;
                }
                qu = q;

                channel.consume(q.queue, function (msg) {

                    const message = JSON.parse(msg.content)
                    const sql = `UPDATE postsdb.posts
                        SET moderatorID = ${message[1]}, status = '${message[2]}'
                        WHERE id = ${message[0]}`;
                    pool.query(sql, (err, res) => {
                        if (err) {
                            console.log(err);
                        }
                        else {
                            console.log("result: ", res)
                        }
                    })

                }, {
                    noAck: true
                });
            });
        });
    });

//Sends post for moderation; Makes first db entry for post
app.post('/messaging', (req, res) => {

    const user = JSON.parse(req.headers['user']);
    try {
        const now = new Date();
        const formattedTimestamp = now.toISOString().slice(0, 19).replace('T', ' ');
        const title = req.body.title;
        const text = req.body.text;
        if (!title || !text) {
            res.status(500).send();
        } else {
            const sql = `INSERT INTO postsdb.posts (userId, moderatorId, status, timestamp, title, text)
            VALUES (${user.id}, 0, '${StatusEnum.PENDING}', '${formattedTimestamp}', '${title}', '${text}')`;
            pool.query(sql, (err, response) => {
                if (err) {
                    console.log(err);
                    res.status(500).send();
                }
                else {
                    const insertId = response.insertId;
                    sendMessageWithRetry('rpc_queue', Buffer.from(insertId.toString()), {
                        replyTo: qu.queue
                    }, 3, 0) // retry 3 times with no delay
                        .then(() => {
                            res.status(201).send();
                        })
                        .catch((retryError) => {
                            console.log('Failed after retries', retryError);
                            // Handle failure after retries, e.g., log, flag in DB, etc.
                            res.status(500).send();
                        });
                }
            })
        }

    } catch {
        res.status(500).send();
    }
})

function sendMessageWithRetry(queue, message, options, maxRetries, delay) {
    return new Promise((resolve, reject) => {
        const attemptToSend = (retriesLeft) => {
            try {
                consumedChannel.sendToQueue(queue, message, options);
                resolve();
            } catch (error) {
                if (retriesLeft === 0) {
                    reject(error);
                } else {
                    setTimeout(() => {
                        attemptToSend(retriesLeft - 1);
                    }, delay);
                }
            }
        };

        attemptToSend(maxRetries);
    });
}

app.delete('/delete', (req, res) => {
    const user = JSON.parse(req.headers['user']);
    // const sqluser = `DELETE FROM userdb.users WHERE id = ${user.id};`;
    // pool.query(sqluser, (err, res) => {
    //     if (err) {
    //         console.log(err);
    //     }
    //     else {
    //         console.log("result: " + res)
    //     }
    // })
    // const newID = Math.random();
    // const sqlposts = `UPDATE postsdb.posts
    // SET userId = ${newID}
    // WHERE userId = ${user.id};`;
    // pool.query(sqlposts, (err, res) => {
    //     if (err) {
    //         console.log(err);
    //     }
    //     else {
    //         console.log("result: " + res)
    //     }
    // })
    const sqlprojects = `DELETE FROM postsdb.posts WHERE userId = ${user.id};`;
    pool.query(sqlprojects, (err, res) => {
        if (err) {
            console.log(err);
        }
        else {
            console.log("result: " + res)
        }
    })

    res.sendStatus(204);
})

// function generateUuid() {
//     return Math.random().toString() +
//         Math.random().toString() +
//         Math.random().toString();
// }

app.use('/', (req, res, next) => {
    return res.status(200).json({ "msg": "Hello from Posts" })
})

app.listen(8002, () => {
    console.log('Posts is listening to port 8002')
})