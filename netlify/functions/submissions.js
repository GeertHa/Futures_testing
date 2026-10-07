const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
// Trim eventuele onzichtbare spaties weg
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "admin").trim();

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

    // Robuuste token extractie (ongevoelig voor hoofdletters in headers)
    const rawAuth = event.headers.authorization || event.headers.Authorization || "";
    const token = rawAuth.replace(/^Bearer\s+/i, "").trim();

    const fullPath = event.path || "";

    // ------------------------------------------------------------------------
    // 1. BEHEERDERS ENDPOINTS (Pad bevat 'admin')
    // ------------------------------------------------------------------------
    if (fullPath.includes("admin")) {
      if (token !== ADMIN_PASSWORD) {
        return { 
          statusCode: 401, 
          headers, 
          body: JSON.stringify({ error: "Verkeerd wachtwoord" }) 
        };
      }

      // D. Gebruikers importeren vanuit CSV/Excel/ODS
      if (event.httpMethod === "POST" && fullPath.includes("import-users")) {
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

      // E. Alle submissions ophalen voor het beheeroverzicht
      if (event.httpMethod === "GET") {
        const submissions = await submissionsCol.find({}).sort({ timestamp: -1 }).toArray();
        return { statusCode: 200, headers, body: JSON.stringify(submissions) };
      }
    }

    // ------------------------------------------------------------------------
    // 2. REGULIERE GEBRUIKERS ENDPOINTS
    // ------------------------------------------------------------------------

    // A. Users lijst voor de Section / User dropdowns
    if (event.httpMethod === "GET" && fullPath.includes("users")) {
      const users = await usersCol.find({}, { projection: { user: 1, studentId: 1, section: 1 } }).toArray();
      return { statusCode: 200, headers, body: JSON.stringify(users) };
    }

    // B. Gebruiker historiek ophalen
    if (event.httpMethod === "GET" && fullPath.includes("user-history")) {
      const parts = fullPath.split("/");
      const studentId = decodeURIComponent(parts[parts.length - 1]);
      const history = await submissionsCol.find({ studentId }).sort({ timestamp: -1 }).toArray();
      return { statusCode: 200, headers, body: JSON.stringify(history) };
    }

    // C. Test opslaan
    if (event.httpMethod === "POST") {
      const data = JSON.parse(event.body);

      const userExists = await usersCol.findOne({ studentId: data.studentId });
      if (!userExists) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: "Gebruiker niet geregistreerd." }) };
      }

      const now = new Date();
      const document = {
        studentId: data.studentId,
        userName: userExists.user,
        section: userExists.section,
        testType: data.testType, // 'FL' of 'FC'
        scores: data.scores,
        reverseScores: data.reverseScores || null,
        timestamp: now.toISOString(),
        dateStr: now.toLocaleDateString("nl-NL"),
        timeStr: now.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })
      };

      const res = await submissionsCol.insertOne(document);
      return { statusCode: 201, headers, body: JSON.stringify({ success: true, id: res.insertedId, ...document }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: "Route niet gevonden: " + fullPath }) };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
