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
let correlationIds = [];
let qu;

//MySQL connection
const pool = createPool({
    host: "34.32.226.52",
    user: "root",
    password: "password"
})

//Array of retrieved items; could be deleted
let posts = [
    {
        username: 'Lazy',
        title: 'post 1'
    },
    {
        username: 'Krisi',
        title: 'post 2'
    },
    {
        username: 'Maya',
        title: 'post 3'
    }
]

//GET all posts
app.get('/posts', (req, res) => {
    pool.query(`select * from postsdb.posts`, (err, result) => {
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
    console.log(user)
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

//Messaging
amqp.connect('amqps://pepqwzfo:QdtFkPU3RuBGMfsFlMiXPlI0JylxB1nu@rat.rmq2.cloudamqp.com/pepqwzfo',
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

                console.log(' [x] Requesting fib(%d)');

                channel.consume(q.queue, function (msg) {
                    if (correlationIds.includes(msg.properties.correlationId)) {
                        console.log(' [.] Got %s', msg.content[2]);
                        const message = JSON.parse(msg.content)
                        console.log(message)
                        const sql = `UPDATE postsdb.posts
                        SET moderatorID = ${message[1]}, status = '${message[2]}'
                        WHERE id = ${message[0]}`;
                        pool.query(sql, (err, res) => {
                            if (err) {
                                console.log(err);
                            }
                            else {
                                console.log("result: " + res)
                            }
                        })
                    }
                }, {
                    noAck: true
                });
            });
        });
    });


app.post('/messaging', (req, res) => {

    const user = JSON.parse(req.headers['user']);
    try {
        const now = new Date();
        let insertId;
        const formattedTimestamp = now.toISOString().slice(0, 19).replace('T', ' ');
        const sql = `INSERT INTO postsdb.posts (userId, projectId, moderatorId, status, timestamp)
        VALUES (${user.id}, '${req.body.projectId}', 0, '${StatusEnum.PENDING}', '${formattedTimestamp}')`;
        pool.query(sql, (err, response) => {
            if (err) {
                console.log(err);
                res.status(500).send();
            }
            else {
                insertId = response.insertId;
                // console.log("insertId:", insertId);ss
                const correlationId = generateUuid();
                correlationIds.push(correlationId);
                consumedChannel.sendToQueue('rpc_queue', Buffer.from(insertId.toString()), {
                    correlationId: correlationId,
                    replyTo: qu.queue
                });
                // console.log("result: ", res)
                res.status(201).send();
            }
        })
        // console.log(consumedChannel)

        
    } catch {
        res.status(500).send();
    }
})

app.delete('/delete', (req, res) => {
    const user = JSON.parse(req.headers['user']);
    const sqluser = `DELETE FROM userdb.users WHERE id = ${user.id};`;
    pool.query(sqluser, (err, res) => {
        if (err) {
            console.log(err);
        }
        else {
            console.log("result: " + res)
        }
    })
    const newID = Math.random();
    const sqlposts = `UPDATE postsdb.posts
    SET userId = ${newID}
    WHERE userId = ${user.id};`;
    pool.query(sqlposts, (err, res) => {
        if (err) {
            console.log(err);
        }
        else {
            console.log("result: " + res)
        }
    })
    const sqlprojects = `DELETE FROM projectsdb.projects WHERE userId = ${user.id};`;
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

function generateUuid() {
    return Math.random().toString() +
        Math.random().toString() +
        Math.random().toString();
}

app.use('/', (req, res, next) => {
    return res.status(200).json({ "msg": "Hello from Posts" })
})

app.listen(8002, () => {
    console.log('Posts is listening to port 8002')
})