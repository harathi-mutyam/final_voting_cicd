
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

// ----------------------------------------------------
// Redis connection
// ----------------------------------------------------

const redisClient = createClient({
  url: `redis://${redisHost}:6379`
});

redisClient.on('error', function (err) {
  console.error('[RESULT] Redis connection error:', err.message);
});

redisClient.connect()
  .then(function () {
    console.log('[RESULT] Connected to Redis');
  })
  .catch(function (err) {
    console.error('[RESULT] Unable to connect to Redis:', err.message);
  });

// ----------------------------------------------------
// Socket.IO - Client activity logging
// ----------------------------------------------------

io.on('connection', function (socket) {

  console.log('[RESULT] Client connected:', socket.id);

  socket.emit('message', { text: 'Welcome!' });

  socket.on('subscribe', function (data) {
    socket.join(data.channel);

    console.log(
      '[RESULT] Client subscribed to:',
      data.channel
    );
  });

  socket.on('disconnect', function (reason) {
    console.log(
      '[RESULT] Client disconnected:',
      socket.id,
      'Reason:',
      reason
    );
  });

});

// ----------------------------------------------------
// PostgreSQL connection
// ----------------------------------------------------

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
        console.error('[RESULT] Waiting for db:', err.message);
        return callback(err);
      }

      done();
      callback(null);
    });
  },

  function (err) {

    if (err) {
      console.error('[RESULT] Giving up connecting to db');
      return;
    }

    console.log('[RESULT] Connected to db');

    getVotes();
  }
);

// ----------------------------------------------------
// Voting results
// Demo mode: display only the latest processed vote
// ----------------------------------------------------

// Remember previous vote to avoid logging every second
let previousVote;

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

    // Log only when the latest vote changes
    if (latestVote !== previousVote) {

      console.log(
        '[RESULT] Latest vote updated:',
        latestVote
      );

      previousVote = latestVote;
    }

    // Send voting results to connected clients
    io.sockets.emit('scores', JSON.stringify(votes));

  } catch (err) {

    console.error(
      '[RESULT] Error retrieving latest demo vote:',
      err.message
    );

  } finally {

    // Continue checking Redis every second
    setTimeout(getVotes, 1000);
  }
}

// ----------------------------------------------------
// Express middleware
// ----------------------------------------------------

app.use(cookieParser());

app.use(express.urlencoded({ extended: true }));

app.use(express.static(__dirname + '/views'));

// ----------------------------------------------------
// Result application route
// ----------------------------------------------------

app.get('/', function (req, res) {

  res.sendFile(
    path.resolve(__dirname + '/views/index.html')
  );

});

// ----------------------------------------------------
// Start Result application
// ----------------------------------------------------

server.listen(port, function () {

  console.log(
    '[RESULT] App running on port ' +
    server.address().port
  );

});

