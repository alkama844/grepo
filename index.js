const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
const { MongoClient } = require("mongodb");

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const {
  GITHUB_TOKEN,
  GITHUB_REPO,
  GITHUB_FILE_PATH,
  MONGODB_URI
} = process.env;

const ADMIN_PASSWORD = "nafijpro";
let systemLocked = false;


const client = new MongoClient(MONGODB_URI);

let logsCollection;

client.connect()
  .then(() => {
    const db = client.db("secure_edit");
    logsCollection = db.collection("edit_logs");
    console.log("🟢 Connected to MongoDB");
  })
  .catch(err => {
    console.error("❌ MongoDB connection failed:", err);
  });

async function logAction(type, data = {}) {
  if (!logsCollection) return;
  await logsCollection.insertOne({ type, data, timestamp: new Date() });
}

async function getFileInfo() {
  const res = await axios.get(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    }
  );
  return res.data;
}

async function getLastCommitTime() {
  const res = await axios.get(
    `https://api.github.com/repos/${GITHUB_REPO}/commits?path=${GITHUB_FILE_PATH}&page=1&per_page=1`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    }
  );
  return new Date(res.data[0].commit.committer.date);
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date) / 1000);
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

app.get("/", async (req, res) => {
  try {
    const file = await getFileInfo();
    const content = Buffer.from(file.content, "base64").toString("utf-8");
    const lastCommitDate = await getLastCommitTime();
    const updatedAgo = timeAgo(lastCommitDate);

    res.send(`
      <html>
        <head>
          <title>GitHub File Editor</title>
          <style>
            body { font-family: monospace; padding: 2rem; background:#f7f7f7; }
            textarea { width: 100%; height: 550px; font-family: monospace; font-size: 14px; }
            button {
              padding: 10px 15px;
              font-size: 16px;
              cursor: pointer;
              border: none;
              border-radius: 6px;
              background-color: #007bff;
              color: white;
              transition: background-color 0.3s ease, transform 0.2s ease;
            }
            button:hover {
              background-color: #0056b3;
              transform: scale(1.05);
            }
          </style>
        </head>
        <body>
          <h2>📝 EDIT BOTS TOKEN ${systemLocked ? '🔐' : ''}</h2>
          <p><strong>Last updated:</strong> ${updatedAgo}</p>
          ${systemLocked ? `<p style="color:red;">System is locked. Editing is disabled.</p>` : `
            <form method="POST" action="/update">
              <textarea name="content">${content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</textarea><br><br>
              <button type="submit">💾 Save</button>
            </form>`}
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send("Failed to load file: " + err.message);
  }
});

app.post("/update", async (req, res) => {
  try {
    if (systemLocked) return res.status(403).send("System is locked. Editing disabled.");
    const file = await getFileInfo();
    const contentEncoded = Buffer.from(req.body.content).toString("base64");

    await axios.put(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`,
      {
        message: "Updated via GitHub Web Editor",
        content: contentEncoded,
        sha: file.sha
      },
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json"
        }
      }
    );

    await logAction("edit", { action: "update", file: GITHUB_FILE_PATH });
    res.redirect("/");
  } catch (err) {
    res.status(500).send("Update failed: " + err.message);
  }
});

app.get("/admin", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Admin Panel</title>
        <style>
          body { font-family: monospace; padding: 2rem; }
          input, button {
            padding: 10px;
            font-size: 16px;
            margin: 5px;
          }
          button {
            cursor: pointer;
            border: none;
            border-radius: 6px;
            background-color: #333;
            color: white;
            transition: background-color 0.3s ease, transform 0.2s ease;
          }
          button:hover {
            background-color: #555;
            transform: scale(1.05);
          }
        </style>
      </head>
      <body>
        <h2>🔧 Admin Panel</h2>
        <form method="POST" action="/admin">
          <p>Password: <input type="password" name="password" /></p>
          <button name="action" value="lock">🔐 Lock System</button>
          <button name="action" value="unlock">🔓 Unlock System</button>
          <button name="action" value="clear" style="background-color:red;">🧹 Clear File</button>
        </form>
        <p><a href="/">⬅️ Back</a></p>
      </body>
    </html>
  `);
});

app.post("/admin", async (req, res) => {
  const { password, action } = req.body;

  if (password !== ADMIN_PASSWORD) return res.status(401).send("❌ Wrong password!");

  if (action === "lock") {
    systemLocked = true;
    await logAction("admin", { action: "lock" });
    return res.send("✅ System locked. <a href='/admin'>Back</a>");
  }

  if (action === "unlock") {
    systemLocked = false;
    await logAction("admin", { action: "unlock" });
    return res.send("✅ System unlocked. <a href='/admin'>Back</a>");
  }

  if (action === "clear") {
    try {
      const file = await getFileInfo();
      await axios.put(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`,
        {
          message: "File cleared by admin",
          content: Buffer.from("").toString("base64"),
          sha: file.sha
        },
        {
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json"
          }
        }
      );
      await logAction("admin", { action: "clear" });
      return res.send("✅ File cleared. <a href='/admin'>Back</a>");
    } catch (err) {
      return res.status(500).send("❌ Clear failed: " + err.message);
    }
  }

  res.send("❌ Unknown action. <a href='/admin'>Back</a>");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
