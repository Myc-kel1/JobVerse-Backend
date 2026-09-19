require("dotenv").config();

async function testGroq() {
  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: process.env.GROQ_PRIMARY_MODEL,
          temperature: 0.1,
          max_tokens: 100,
          messages: [
            {
              role: "user",
              content: 'Return ONLY this JSON: {"test":true}'
            }
          ]
        })
      }
    );

    const body = await response.text();

    console.log("STATUS:", response.status);
    console.log("BODY:", body);
  } catch (error) {
    console.error("ERROR:", error.message);
  }
}

testGroq();