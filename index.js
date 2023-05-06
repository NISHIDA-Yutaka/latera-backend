const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  // PostgreSQLデータベースの接続情報を設定する
  user: "latera_user",
  host: "localhost",
  database: "latera_db",
  password: "your_password",
  port: 5432 // PostgreSQLのデフォルトポート
});

app.post("/articles", async (req, res) => {
  try {
    const { title, url, content } = req.body;

    const newArticle = await pool.query(
      "INSERT INTO articles (title, url, content) VALUES ($1, $2, $3) RETURNING *",
      [title, url, content]
    );

    res.json(newArticle.rows[0]);
  } catch (error) {
    console.error("Error inserting article:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/articleinfo", async (req, res) => {
  try {
    const { url } = req.query;
    // ここで実際の記事情報を取得する処理を実装する
    // 今回はダミーの情報を返す
    const articleInfo = {
      title: "Dummy title",
      content: "Dummy content",
    };
    res.json(articleInfo);
  } catch (error) {
    console.error("Error fetching article info:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
