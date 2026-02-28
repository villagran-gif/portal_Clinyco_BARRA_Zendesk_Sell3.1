const { google } = require('googleapis');

function getServiceAccountCredentials() {
  // Option A: JSON in one env var
  const rawJson = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson) {
    const creds = JSON.parse(rawJson);
    if (creds.private_key && String(creds.private_key).includes('\\n')) {
      creds.private_key = String(creds.private_key).replace(/\\n/g, '\n');
    }
    return creds;
  }

  // Option B: email + private key
  const email = String(process.env.GOOGLE_CLIENT_EMAIL || '').trim();
  let key = String(process.env.GOOGLE_PRIVATE_KEY || '').trim();
  if (!email || !key) {
    const err = new Error('Faltan credenciales Google. Define GOOGLE_SERVICE_ACCOUNT_JSON o GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY');
    err.code = 'MISSING_GOOGLE_CREDS';
    throw err;
  }
  if (key.includes('\\n')) key = key.replace(/\\n/g, '\n');
  return { client_email: email, private_key: key };
}

function getAuth() {
  const creds = getServiceAccountCredentials();
  const scopes = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
  ];

  if (creds.type === 'service_account' || creds.client_id) {
    // google-auth-library can take the full JSON
    const auth = new google.auth.GoogleAuth({ credentials: creds, scopes });
    return auth;
  }

  // Fallback: JWT
  const jwt = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes,
  });
  return jwt;
}

function getClients() {
  const auth = getAuth();
  return {
    auth,
    drive: google.drive({ version: 'v3', auth }),
    docs: google.docs({ version: 'v1', auth }),
  };
}

module.exports = { getClients };
