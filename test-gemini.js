require("dotenv").config();

const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function main() {
  try {
    console.log("Testing Gemini...");

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: "Return exactly this JSON: {\"status\":\"ok\",\"provider\":\"gemini\"}",
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
            },
            provider: {
              type: "string",
            },
          },
          required: ["status", "provider"],
        },
      },
    });

    console.log("\nGemini response:");
    console.log(response.text);

    console.log("\nGemini test successful.");
  } catch (error) {
    console.error("\nGemini test failed:");
    console.error(error.message);
  }
}

main();