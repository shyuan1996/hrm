
import { GoogleGenAI, Type } from "@google/genai";
import { AttendanceRecord, LeaveRequest, User } from '../types';

export const GeminiService = {
  generateDailyReport: async (
    date: string,
    records: AttendanceRecord[],
    leaves: LeaveRequest[],
    users: User[]
  ) => {
    // Check if API key is available
    if (!process.env.API_KEY) {
      return {
        summary: "API Key not configured. Please check environment variables.",
        anomalies: [],
        recommendations: []
      };
    }

    // Always use the required initialization format with process.env.API_KEY directly.
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    // Filter data for the specific date
    const dailyRecords = records.filter(r => r.date === date);
    const dailyLeaves = leaves.filter(l => l.start.startsWith(date));
    
    // Prepare context for Gemini
    const contextData = {
      date,
      totalEmployees: users.length,
      presentCount: new Set(dailyRecords.map(r => r.userId)).size,
      leaveCount: dailyLeaves.length,
      lateArrivals: dailyRecords.filter(r => r.type === 'in' && r.time > '09:00:00').length, // Assuming 9am start
      records: dailyRecords.map(r => `${r.userName} (${r.type}): ${r.time}`),
      leaves: dailyLeaves.map(l => `${l.userName}: ${l.type}`)
    };

    const prompt = `
      Analyze the attendance data for ${date}.
      Data: ${JSON.stringify(contextData)}
      
      Provide a professional HR summary including:
      1. A general summary of the day.
      2. Any anomalies (late arrivals, unexpected absences).
      3. Recommendations for management.
    `;

    try {
      // Use ai.models.generateContent with 'gemini-3-flash-preview' for basic text tasks.
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              anomalies: { type: Type.ARRAY, items: { type: Type.STRING } },
              recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["summary", "anomalies", "recommendations"]
          }
        }
      });
      
      // Access the .text property directly (it's a property, not a method).
      const resultText = response.text;
      if (resultText) {
          try {
            return JSON.parse(resultText);
          } catch (e) {
            console.error("Failed to parse JSON from AI response:", resultText);
            return null;
          }
      }
      return null;
    } catch (error) {
      console.error("Gemini AI Error:", error);
      throw error;
    }
  }
};
