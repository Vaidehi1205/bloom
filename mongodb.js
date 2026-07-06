const { MongoClient } = require('mongodb');
require('dotenv').config();

let client;
let db;

function getMongoUri() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGODB_URI in environment (.env).');
  return uri;
}

function getDbName() {
  return process.env.MONGODB_DB_NAME || 'bloom';
}

async function connectMongo() {
  if (db) return db;

  const uri = getMongoUri();
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(getDbName());
  return db;
}

function getDb() {
  if (!db) throw new Error('MongoDB is not connected. Call connectMongo() at startup.');
  return db;
}

async function initMongo() {
  await connectMongo();
  return db;
}

module.exports = {
  initMongo,
  getDb,
};

