
var express = require('express'),
    async = require('async'),
    { Pool } = require('pg'),
    cookieParser = require('cookie-parser'),
    path = require('path'),
    app = express(),
    server = require('http').Server(app),
    io = require('socket.io')(server);

const { createClient } = require('redis');

var port = process.env.PORT || 4000;

var dbHost = process.env.DB_HOST || 'db';
var dbPassword = process.env.DB_PASSWORD;
var redisHost = process.env.REDIS_HOST || 'redis';

if (!dbPassword) {
  console.error('DB_PASSWORD environment variable is required');
  process.exit(1);
}

// Redis client for latest-vote demo mode
const redisClient = createClient({
  url: `redis://${redisHost}:6379`
});

redisClient.on('error', function (err) {
  console.error('Redis connection error:', err.message);
});

redisClient.connect()
  .then(function () {
    console.log('Connected to Redis');
  })
  .catch(function (err) {
    console.error('Unable to connect to Redis:', err.message);
  });

// Socket.IO
io.on('connection', function (socket) {
  socket.emit('message', { text: 'Welcome!' });

  socket.on('subscribe', function (data) {
    socket.join(data.channel);
  });
});

// PostgreSQL connection
var pool = new Pool({
  host: dbHost,
  port: 5432,
  user: 'postgres',
  password: dbPassword,
  database: 'postgres'
});

async.retry(
  { times: 1000, interval: 1000 },

  function (callback) {
    pool.connect(function (err, client, done) {
      if (err) {
        console.error('Waiting for db:', err.message);
        return callback(err);
      }

      done();
      callback(null);
    });
  },

  function (err) {
    if (err) {
      console.error('Giving up');
      return;
    }

    console.log('Connected to db');
    getVotes();
  }
);

// Demo mode: display only the latest processed vote
async function getVotes() {
  try {
    if (!redisClient.isReady) {
      throw new Error('Redis client is not ready');
    }

    const latestVote = await redisClient.get('demo:last-vote');

    const votes = {
      a: latestVote === 'a' ? 1 : 0,
      b: latestVote === 'b' ? 1 : 0
    };

    io.sockets.emit('scores', JSON.stringify(votes));

  } catch (err) {
    console.error('Error retrieving latest demo vote:', err.message);
  } finally {
    setTimeout(getVotes, 1000);
  }
}

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname + '/views'));

app.get('/', function (req, res) {
  res.sendFile(path.resolve(__dirname + '/views/index.html'));
});

server.listen(port, function () {
  console.log('App running on port ' + server.address().port);
});
