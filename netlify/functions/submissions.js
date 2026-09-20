const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

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

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const client = await connectToDatabase();
    const db = client.db("futures_db");
    const usersCol = db.collection("users");
    const submissionsCol = db.collection("submissions");

    const path = event.path.replace(/\/\.netlify\/functions\/submissions\/?/, "");
    const authHeader = event.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");

    // ------------------------------------------------------------------------
    // 1. ENDPOINTS VOOR REGULIERE GEBRUIKERS
    // ------------------------------------------------------------------------

    // A. Haal alle geregistreerde gebruikers op (voor de Section/User dropdowns)
    if (event.httpMethod === "GET" && path === "users") {
      const users = await usersCol.find({}, { projection: { user: 1, studentId: 1, section: 1 } }).toArray();
      return { statusCode: 200, headers, body: JSON.stringify(users) };
    }

    // B. Haal alle testen van één specifieke gebruiker op
    if (event.httpMethod === "GET" && path.startsWith("user-history/")) {
      const studentId = decodeURIComponent(path.split("/")[1]);
      const history = await submissionsCol.find({ studentId }).sort({ timestamp: -1 }).toArray();
      return { statusCode: 200, headers, body: JSON.stringify(history) };
    }

    // C. Test opslaan
    if (event.httpMethod === "POST" && (path === "" || path === "submit")) {
      const data = JSON.parse(event.body);

      // Controleer of de gebruiker geregistreerd is
      const userExists = await usersCol.findOne({ studentId: data.studentId });
      if (!userExists) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: "Gebruiker niet geregistreerd." })
        };
      }

      const now = new Date();
      const document = {
        studentId: data.studentId,
        userName: userExists.user,
        section: userExists.section,
        testType: data.testType, // 'FL' of 'FC'
        scores: data.scores,
        timestamp: now.toISOString(),
        dateStr: now.toLocaleDateString("nl-NL"),
        timeStr: now.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })
      };

      const res = await submissionsCol.insertOne(document);
      return { statusCode: 201, headers, body: JSON.stringify({ success: true, id: res.insertedId, ...document }) };
    }

    // ------------------------------------------------------------------------
    // 2. ENDPOINTS VOOR DE ADMINISTRATOR
    // ------------------------------------------------------------------------
    if (token !== ADMIN_PASSWORD) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Niet geautoriseerd" }) };
    }

    // D. Gebruikers importeren vanuit CSV/Excel (upsert op studentId)
    if (event.httpMethod === "POST" && path === "admin/import-users") {
      const { users } = JSON.parse(event.body);
      if (!Array.isArray(users) || users.length === 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Geen data aangeleverd" }) };
      }

      const operations = users.map(u => ({
        updateOne: {
          filter: { studentId: String(u.ID).trim() },
          update: {
            $set: {
              user: String(u.User).trim(),
              studentId: String(u.ID).trim(),
              section: String(u.Section).trim()
            }
          },
          upsert: true
        }
      }));

      await usersCol.bulkWrite(operations);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, count: users.length }) };
    }

    // E. Alle submissions ophalen voor het admin dashboard
    if (event.httpMethod === "GET" && (path === "" || path === "admin/submissions")) {
      const submissions = await submissionsCol.find({}).sort({ timestamp: -1 }).toArray();
      return { statusCode: 200, headers, body: JSON.stringify(submissions) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: "Endpoint niet gevonden" }) };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
