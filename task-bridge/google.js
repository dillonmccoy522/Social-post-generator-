const { google } = require('googleapis');

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

function getAuth() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

function tasksApi() {
  return google.tasks({ version: 'v1', auth: getAuth() });
}

function calendarApi() {
  return google.calendar({ version: 'v3', auth: getAuth() });
}

module.exports = { isConfigured, tasksApi, calendarApi };
