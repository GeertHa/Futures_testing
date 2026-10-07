// In het POST-gedeelte van netlify/functions/submissions.js:
const document = {
  studentId: data.studentId,
  userName: userExists.user,
  section: userExists.section,
  testType: data.testType, // 'FL' of 'FC'
  scores: data.scores,
  reverseScores: data.reverseScores || null, // <--- Voeg deze regel toe
  timestamp: now.toISOString(),
  dateStr: now.toLocaleDateString("nl-NL"),
  timeStr: now.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })
};