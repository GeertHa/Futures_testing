const { MongoClient, ObjectId } = require("mongodb");

const uri = process.env.MONGODB_URI;
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "admin").trim();

let cachedClient = null;

async function connectToDatabase() {
  if (cachedClient) return cachedClient;
  if (!uri) {
    throw new Error("MONGODB_URI omgevingsvariabele ontbreekt in Netlify.");
  }
  const client = new MongoClient(uri);
  await client.connect();
  cachedClient = client;
  return client;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

    const rawAuth = event.headers.authorization || event.headers.Authorization || "";
    const token = rawAuth.replace(/^Bearer\s+/i, "").trim();
    const fullPath = event.path || "";
    const params = event.queryStringParameters || {};
    const action = params.action || "";

    // ------------------------------------------------------------------------
    // 1. BEHEERDERS ENDPOINTS (Via query param ?action=admin_... OF pad bevat 'admin')
    // ------------------------------------------------------------------------
    if (action.startsWith("admin") || fullPath.includes("admin")) {
      if (token !== ADMIN_PASSWORD) {
        return { 
          statusCode: 401, 
          headers, 
          body: JSON.stringify({ error: "Verkeerd wachtwoord" }) 
        };
      }

      // D. Gebruikers importeren (Upsert: bestaande data blijft volledig behouden)
      if (event.httpMethod === "POST" && (action === "admin_import_users" || fullPath.includes("import-users"))) {
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

      // E. Alle submissions ophalen
      if (event.httpMethod === "GET") {
        const submissions = await submissionsCol.find({}).sort({ timestamp: -1 }).toArray();
        return { statusCode: 200, headers, body: JSON.stringify(submissions) };
      }

      // F. WISMOGELIJKHEDEN (DELETE)
      if (event.httpMethod === "DELETE") {
        if (params.id) {
          let filter = {};
          try {
            filter = { _id: new ObjectId(params.id) };
          } catch(e) {
            filter = { id: params.id };
          }
          const res = await submissionsCol.deleteOne(filter);
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, deletedCount: res.deletedCount }) };
        }

        if (params.section && params.section !== "ALL") {
          const res = await submissionsCol.deleteMany({ section: params.section });
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, deletedCount: res.deletedCount }) };
        }

        if (params.clearUsers === "true") {
          const res = await usersCol.deleteMany({});
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, deletedCount: res.deletedCount }) };
        }

        if (params.allSubmissions === "true") {
          const res = await submissionsCol.deleteMany({});
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, deletedCount: res.deletedCount }) };
        }

        return { statusCode: 400, headers, body: JSON.stringify({ error: "Geen geldige wis-opdracht opgegeven" }) };
      }
    }

    // ------------------------------------------------------------------------
    // 2. REGULIERE GEBRUIKERS ENDPOINTS
    // ------------------------------------------------------------------------

    // A. Gebruikerslijst ophalen
    if (event.httpMethod === "GET" && (action === "users" || fullPath.includes("users"))) {
      const users = await usersCol.find({}, { projection: { user: 1, studentId: 1, section: 1 } }).toArray();
      return { statusCode: 200, headers, body: JSON.stringify(users) };
    }

    // B. Gebruikershistoriek ophalen
    if (event.httpMethod === "GET" && (action === "user-history" || fullPath.includes("user-history"))) {
      let studentId = params.studentId;
      if (!studentId) {
        const parts = fullPath.split("/");
        studentId = decodeURIComponent(parts[parts.length - 1]);
      }
      const history = await submissionsCol.find({ studentId }).sort({ timestamp: -1 }).toArray();
      return { statusCode: 200, headers, body: JSON.stringify(history) };
    }

    // C. Test opslaan (Inclusief alle individuele antwoorden in 'answers')
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
        testType: data.testType,
        scores: data.scores,
        reverseScores: data.reverseScores || null,
        answers: data.answers || {},
        timestamp: now.toISOString(),
        dateStr: now.toLocaleDateString("nl-NL"),
        timeStr: now.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })
      };

      const res = await submissionsCol.insertOne(document);
      return { statusCode: 201, headers, body: JSON.stringify({ success: true, id: res.insertedId, ...document }) };
    }

    // Default fallback bij GET zonder parameters: geef de gebruikerslijst terug
    if (event.httpMethod === "GET") {
      const users = await usersCol.find({}, { projection: { user: 1, studentId: 1, section: 1 } }).toArray();
      return { statusCode: 200, headers, body: JSON.stringify(users) };
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
