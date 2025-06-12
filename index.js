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

async function logAction(type, data = {}) {
  if (!logsCollection) return;
  await logsCollection.insertOne({ type, data, timestamp: new Date() });
}

// 🔄 Load lock state from DB
async function loadLockState() {
  if (!logsCollection) return;
  const last = await logsCollection
    .find({ type: "lock-state" })
    .sort({ timestamp: -1 })
    .limit(1)
    .toArray();
  if (last.length) {
    systemLocked = last[0].data.locked;
    console.log(`🔒 Lock state restored: ${systemLocked ? "LOCKED" : "UNLOCKED"}`);
  }
}

// 💾 Save lock state to DB
async function saveLockState(locked) {
  systemLocked = locked;
  await logsCollection.insertOne({ type: "lock-state", data: { locked }, timestamp: new Date() });
}

client.connect()
  .then(async () => {
    const db = client.db("secure_edit");
    logsCollection = db.collection("edit_logs");
    console.log("🟢 Connected to MongoDB");
    await loadLockState(); // Initialize lock state
  })
  .catch(err => {
    console.error("❌ MongoDB connection failed:", err);
  });

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
            body { background:#111; color:#0f0; font-family: monospace; padding: 2rem; }
            textarea { width: 100%; height: 550px; background: #222; color: #0f0; font-family: monospace; font-size: 14px; border:1px solid #0f0; }
            button {
              padding: 10px 15px;
              font-size: 16px;
              cursor: pointer;
              border: none;
              border-radius: 6px;
              background-color: #0f0;
              color: #111;
              transition: background-color 0.3s ease, transform 0.2s ease;
            }
            button:hover {
              background-color: #0c0;
              transform: scale(1.05);
            }
          </style>
        </head>
        <body>
          <h2>📝 EDIT BOTS TOKEN ${systemLocked ? '🔐' : ''}</h2>
          <p><strong>Last updated:</strong> ${updatedAgo}</p>
          ${systemLocked
            ? `<p style="color:red;">System is locked. Editing is disabled.</p>`
            : `
            <form method="POST" action="/update">
              <textarea name="content">${content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</textarea><br><br>
              <button type="submit">💾 Save</button>
            </form>`
          }
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
          body { background:#111; color:#0f0; font-family: monospace; padding: 2rem; }
          input, button {
            padding: 10px;
            font-size: 16px;
            margin: 5px;
            background: #222;
            color: #0f0;
            border: 1px solid #0f0;
          }
          button {
            cursor: pointer;
            border-radius: 6px;
            background-color: #0f0;
            color: #111;
            transition: background-color 0.3s ease, transform 0.2s ease;
          }
          button:hover {
            background-color: #0c0;
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
          <button name="action" value="clear" style="background-color:red;color:#fff;">🧹 Clear File</button>
        </form>
        <p><a href="/" style="color:#0f0;">⬅️ Back</a></p>
      </body>
    </html>
  `);
});

app.post("/admin", async (req, res) => {
  const { password, action } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).send("❌ Wrong password!");

  if (action === "lock") {
    await saveLockState(true);
    await logAction("admin", { action: "lock" });
    return res.send("✅ System locked. <a href='/admin'>Back</a>");
  }

  if (action === "unlock") {
    await saveLockState(false);
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

// 🤥 fake codes, console logs, etc.
// (This remains exactly as you wrote—no changes)

let chars = "アァイィウヴカガキギクグケコゴサシスセソタチツテトナニヌネノハバヒビフヘホマミムメモヤユヨラリルレロワン0123456789";
let iCounter = 0;
const interval = setInterval(() => {
  if (iCounter++ > 30) return clearInterval(interval);
  console.log(`%c${Array.from({ length: 50 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")}`, "color: #0f0; font-family: monospace;");
}, 100);

console.log("%c⚠ WARNING ⚠", "color: red; font-size: 30px; font-weight: bold; text-shadow: 2px 2px black;");
console.log("%cThis is a secure zone.\nAny inspection attempt will be logged.\nPowered by: NAFIJ PRO Security Systems™", "color: orange; font-size: 14px; font-family: monospace;");

const style = "color: #0f0; font-family: monospace;";
console.clear();
console.log("%c🛸 INITIATING PROTOCOL: NAFIJ PRO SYSTEM OVERRIDE", style);

setTimeout(() => console.log("%cConnecting to secure terminal...", style), 500);
setTimeout(() => console.log("%cAuthorizing credentials: ****** ✔", style), 1000);
setTimeout(() => console.log("%cFetching app data.json 🔍", style), 1500);
setTimeout(() => console.log("%cBypassing firewall... [%c■■■■■■■■■░░░░░░░░░░%c] 45%%", style, "color: lime", style), 2000);
setTimeout(() => console.log("%cPayload injection successful. Deploying scripts ⚙", style), 2500);
setTimeout(() => console.log("%cActivating root shell... 🔓", style), 3000);
setTimeout(() => console.log("%c[ACCESS GRANTED] Welcome, commander NAFIJ PRO 👨‍💻", "color: #00ff00; font-weight: bold; font-size: 16px;"), 3500);

// End of fake codes

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
