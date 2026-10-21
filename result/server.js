
var express = require('express'),
    async = require('async'),
    { Pool } = require('pg'),
    cookieParser = require('cookie-parser'),
    path = require('path'),
    app = express(),
    server = require('http').Server(app),
    io = require('socket.io')(server);

var port = process.env.PORT || 4000;

var dbHost = process.env.DB_HOST || 'db';
var dbPassword = process.env.DB_PASSWORD;

if (!dbPassword) {
  console.error('DB_PASSWORD environment variable is required');
  process.exit(1);
}

io.on('connection', function (socket) {
  socket.emit('message', { text: 'Welcome!' });

  socket.on('subscribe', function (data) {
    socket.join(data.channel);
  });
});

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

function getVotes() {
  pool.query(
    'SELECT vote, COUNT(id) AS count FROM votes GROUP BY vote',
    [],
    function (err, result) {
      if (err) {
        console.error('Error performing query: ' + err.message);
      } else {
        var votes = collectVotesFromResult(result);
        io.sockets.emit('scores', JSON.stringify(votes));
      }

      setTimeout(getVotes, 1000);
    }
  );
}

function collectVotesFromResult(result) {
  var votes = { a: 0, b: 0 };

  result.rows.forEach(function (row) {
    votes[row.vote] = parseInt(row.count, 10);
  });

  return votes;
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
