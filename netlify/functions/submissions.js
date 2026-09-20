const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

// Hergebruik de database-connectie tussen verschillende aanroepen (caching)
let cachedClient = null;

async function connectToDatabase() {
  if (cachedClient) return cachedClient;
  const client = new MongoClient(uri);
  await client.connect();
  cachedClient = client;
  return client;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };

  // CORS preflight verzoek afhandelen
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const client = await connectToDatabase();
    const db = client.db("futures_db");
    const collection = db.collection("submissions");

    // 1. DATA OPSLAAN (Voor elke deelnemer)
    if (event.httpMethod === "POST") {
      const data = JSON.parse(event.body);
      
      const document = {
        userName: data.userName,
        groupId: data.groupId,
        testType: data.testType, // 'FL' of 'FC'
        scores: data.scores,
        date: new Date().toISOString()
      };

      const result = await collection.insertOne(document);
      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ success: true, id: result.insertedId, ...document })
      };
    }

    // 2. DATA OPHALEN (Alleen beheerder met wachtwoord)
    if (event.httpMethod === "GET") {
      const authHeader = event.headers.authorization || "";
      const token = authHeader.replace("Bearer ", "");

      if (token !== ADMIN_PASSWORD) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: "Niet geautoriseerd" })
        };
      }

      const submissions = await collection.find({}).sort({ date: -1 }).toArray();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(submissions)
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
