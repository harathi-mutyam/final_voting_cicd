
using System;
using System.Data.Common;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using Newtonsoft.Json;
using Npgsql;
using StackExchange.Redis;

namespace Worker
{
    public class Program
    {
        public static int Main(string[] args)
        {
            try
            {
                string dbHost =
                    Environment.GetEnvironmentVariable("DB_HOST") ?? "db";

                string redisHost =
                    Environment.GetEnvironmentVariable("REDIS_HOST") ?? "redis";

                string dbPassword =
                    Environment.GetEnvironmentVariable("DB_PASSWORD");

                if (string.IsNullOrEmpty(dbPassword))
                {
                    throw new InvalidOperationException(
                        "DB_PASSWORD environment variable is required");
                }

                var connectionBuilder = new NpgsqlConnectionStringBuilder
                {
                    Host = dbHost,
                    Username = "postgres",
                    Password = dbPassword,
                    Database = "postgres"
                };

                string connectionString = connectionBuilder.ConnectionString;

                var pgsql = OpenDbConnection(connectionString);
                var redisConn = OpenRedisConnection(redisHost);
                var redis = redisConn.GetDatabase();

                var definition = new { vote = "", voter_id = "" };

                while (true)
                {
                    Thread.Sleep(100);

                    if (redisConn == null || !redisConn.IsConnected)
                    {
                        Console.WriteLine("Reconnecting Redis");
                        redisConn = OpenRedisConnection(redisHost);
                        redis = redisConn.GetDatabase();
                    }

                    // Reconnect before removing the next vote from Redis.
                    if (pgsql.State != System.Data.ConnectionState.Open)
                    {
                        Console.WriteLine("Reconnecting DB");
                        pgsql.Dispose();
                        pgsql = OpenDbConnection(connectionString);
                    }

                    string json = redis.ListLeftPopAsync("votes").Result;

                    if (json != null)
                    {
                        var vote = JsonConvert.DeserializeAnonymousType(
                            json, definition);

                        Console.WriteLine(
                            $"Processing vote for '{vote.vote}' by '{vote.voter_id}'");

                        UpdateVote(pgsql, vote.voter_id, vote.vote);
                    }
                    else
                    {
                        using (var keepAliveCommand = pgsql.CreateCommand())
                        {
                            keepAliveCommand.CommandText = "SELECT 1";
                            keepAliveCommand.ExecuteNonQuery();
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.ToString());
                return 1;
            }
        }

        private static NpgsqlConnection OpenDbConnection(
            string connectionString)
        {
            while (true)
            {
                try
                {
                    var connection = new NpgsqlConnection(connectionString);
                    connection.Open();

                    Console.WriteLine("Connected to db");

                    using (var command = connection.CreateCommand())
                    {
                        command.CommandText = @"
                            CREATE TABLE IF NOT EXISTS votes (
                                id VARCHAR(255) NOT NULL UNIQUE,
                                vote VARCHAR(255) NOT NULL
                            )";

                        command.ExecuteNonQuery();
                    }

                    return connection;
                }
                catch (DbException)
                {
                    Console.Error.WriteLine("Waiting for db");
                    Thread.Sleep(1000);
                }
            }
        }

        private static ConnectionMultiplexer OpenRedisConnection(
            string hostname)
        {
            while (true)
            {
                try
                {
                    var ipAddress = GetIp(hostname);
                    Console.WriteLine($"Found redis at {ipAddress}");
                    Console.WriteLine("Connecting to redis");

                    return ConnectionMultiplexer.Connect(ipAddress);
                }
                catch (RedisConnectionException)
                {
                    Console.Error.WriteLine("Waiting for redis");
                    Thread.Sleep(1000);
                }
                catch (SocketException)
                {
                    Console.Error.WriteLine("Waiting for redis");
                    Thread.Sleep(1000);
                }
            }
        }

        private static string GetIp(string hostname)
        {
            return Dns.GetHostEntryAsync(hostname)
                .Result
                .AddressList
                .First(a => a.AddressFamily == AddressFamily.InterNetwork)
                .ToString();
        }

        private static void UpdateVote(
            NpgsqlConnection connection,
            string voterId,
            string vote)
        {
            using (var command = connection.CreateCommand())
            {
                command.CommandText = @"
                    INSERT INTO votes (id, vote)
                    VALUES (@id, @vote)
                    ON CONFLICT (id)
                    DO UPDATE SET vote = EXCLUDED.vote";

                command.Parameters.AddWithValue("@id", voterId);
                command.Parameters.AddWithValue("@vote", vote);

                command.ExecuteNonQuery();
            }
        }
    }
}
