const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  nodemailer = null;
}

let PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const BASE_DIR = fs.existsSync(path.join(__dirname, 'index.html'))
  ? __dirname
  : (fs.existsSync(path.join(process.cwd(), 'index.html')) ? process.cwd() : __dirname);
const PARENT_ASSETS_DIR = path.resolve(BASE_DIR, '..', 'assets');

// Load environment variables from .env.local or .env if present
try {
  const envLocal = path.join(BASE_DIR, '.env.local');
  if (fs.existsSync(envLocal)) {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(envLocal);
    } else {
      const lines = fs.readFileSync(envLocal, 'utf8').split('\n');
      for (const line of lines) {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let val = (match[2] || '').trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          if (!process.env[key]) process.env[key] = val;
        }
      }
    }
  }
} catch (e) {}

// SadikMed In-Memory OTP Store
const sadikmedOtps = new Map(); // key: recipient, value: { code, expiresAt, channel }
const otpCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sadikmedOtps) {
    if (v.expiresAt < now) sadikmedOtps.delete(k);
  }
}, 60000);
if (otpCleanupTimer.unref) otpCleanupTimer.unref();

// Helper: Google Gmail SMTP Dispatcher
let cachedGmailTransporter = null;
let cachedGmailKey = '';

function getGmailTransporter(user, pass) {
  const key = `${user}:${pass}`;
  if (cachedGmailTransporter && cachedGmailKey === key) {
    return cachedGmailTransporter;
  }
  cachedGmailTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    pool: true,
    maxConnections: 3,
    socketTimeout: 8000,
    connectionTimeout: 6000,
    auth: { user, pass }
  });
  cachedGmailKey = key;
  return cachedGmailTransporter;
}

async function dispatchMail(mailOptions) {
  const configFile = path.join(BASE_DIR, 'data', 'email-config.json');
  let config = { enabled: false };
  try {
    if (fs.existsSync(configFile)) {
      config = JSON.parse(fs.readFileSync(configFile, 'utf8') || '{}');
    }
  } catch (e) {}

  if (!nodemailer) {
    return { sent: false, reason: 'nodemailer module not installed' };
  }

  // Google Gmail Credentials
  const user = process.env.GMAIL_USER || (config.auth && config.auth.user) || 'noreply.sadikmed@gmail.com';
  const rawPass = process.env.GMAIL_PASS || (config.auth && config.auth.pass);
  const pass = rawPass ? rawPass.replace(/\s+/g, '') : '';
  const isRealPass = pass && !pass.includes('PASTE_YOUR');

  // 1. Send via Google Gmail SMTP (smtp.gmail.com:465 SSL)
  if (isRealPass && user) {
    try {
      const transporter = getGmailTransporter(user, pass);
      const senderFrom = process.env.MAIL_FROM || config.from || `"SadikMed Tracker" <${user}>`;
      const info = await transporter.sendMail({
        from: senderFrom,
        to: mailOptions.to,
        replyTo: mailOptions.replyTo || 'info.raayhansadik@gmail.com',
        subject: mailOptions.subject,
        html: mailOptions.html,
        text: mailOptions.text,
        attachments: mailOptions.attachments || []
      });
      console.log(`[GOOGLE GMAIL DELIVERED] Sent to: ${mailOptions.to} (Message ID: ${info.messageId})`);
      return { sent: true, realSmtp: true, messageId: info.messageId };
    } catch (smtpErr) {
      console.error(`[GOOGLE GMAIL SMTP ERROR]:`, smtpErr.message);
      cachedGmailTransporter = null;
    }
  }

  // 2. Fallback to Ethereal Webmail Sandbox when Google App Password is not yet set
  try {
    const testAccount = await nodemailer.createTestAccount();
    const testTransporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
    const info = await testTransporter.sendMail({
      from: `"SadikMed Tracker" <${user}>`,
      to: mailOptions.to,
      replyTo: mailOptions.replyTo || 'info.raayhansadik@gmail.com',
      subject: mailOptions.subject,
      html: mailOptions.html,
      text: mailOptions.text,
      attachments: mailOptions.attachments || []
    });
    const previewUrl = nodemailer.getTestMessageUrl(info);
    console.log(`[TEST INBOX READY] Click to view delivered message in webmail: ${previewUrl}`);
    return { sent: true, realSmtp: false, previewUrl: previewUrl };
  } catch (testErr) {
    console.error(`[TEST TRANSPORT ERROR]:`, testErr.message);
    return { sent: false, error: testErr.message };
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function createPlaceholderSvg(title, width = 640, height = 360, isAvatar = false) {
  if (isAvatar) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
      <rect width="100%" height="100%" fill="#1F7A4D"/>
      <circle cx="60" cy="48" r="24" fill="#FFE9A8"/>
      <circle cx="60" cy="110" r="42" fill="#FFE9A8"/>
      <text x="60" y="55" font-family="'DM Sans',sans-serif" font-size="20" font-weight="bold" fill="#14301F" text-anchor="middle">${title.charAt(0).toUpperCase()}</text>
    </svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#14301F"/>
        <stop offset="100%" stop-color="#1F7A4D"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${width / 2}" cy="${height / 2}" r="38" fill="rgba(255,233,168,0.2)"/>
    <polygon points="${width / 2 - 12},${height / 2 - 18} ${width / 2 + 18},${height / 2} ${width / 2 - 12},${height / 2 + 18}" fill="#FFE9A8"/>
    <text x="${width / 2}" y="${height / 2 + 55}" font-family="'DM Sans',sans-serif" font-size="16" font-weight="700" fill="#FFE9A8" text-anchor="middle">${title}</text>
  </svg>`;
}

function requestHandler(req, res) {
  let reqPath = '';
  try {
    reqPath = decodeURI(req.url.split('?')[0]);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  if (reqPath.includes('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // API Route: Book a Call (Dispatches 2 emails & provisions user credentials)
  if (reqPath === '/api/book-call' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const name = (data.name || 'Client').trim();
        const email = (data.email || '').trim().toLowerCase();
        const date = data.date || 'Scheduled Date';
        const time = data.time || '10:00 AM';
        const timezone = data.timezone || 'EST';
        const topic = data.topic || 'General Strategy & Video Production';
        const notes = data.notes || '';
        const password = 'Clipora#2026'; // Standard individual initial password for every booked call

        if (!email) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Email is required' }));
          return;
        }

        // Email 1: Call Confirmation
        const email1 = {
          type: 'call_confirmation',
          to: email,
          recipientName: name,
          subject: 'Confirmed: 15-Minute Content Strategy Call with Md Rayhan Sadik',
          sentAt: new Date().toISOString(),
          details: {
            date: date,
            time: time,
            timezone: timezone,
            host: 'Md Rayhan Sadik (Founder & CEO, Clipora)',
            meetLink: 'https://meet.google.com/clip-ora-call',
            topic: topic
          }
        };

        // Email 2: Client Portal Credentials
        const email2 = {
          type: 'credentials',
          to: email,
          recipientName: name,
          subject: 'Your Clipora Client Portal Login Credentials',
          sentAt: new Date().toISOString(),
          details: {
            portalUrl: 'http://localhost:3000/login',
            username: email,
            password: password
          }
        };

        // Dispatch Email 1
        const dispatchRes1 = await dispatchMail({
          to: email,
          subject: email1.subject,
          html: `
            <div style="font-family:'DM Sans',Arial,sans-serif;max-width:580px;margin:0 auto;padding:24px;background:#F4F7F2;color:#14301F">
              <div style="background:#1F7A4D;color:#fff;padding:16px 24px;border-radius:12px;font-size:20px;font-weight:bold">
                Clipora · Call Confirmed
              </div>
              <div style="background:#fff;padding:28px 24px;border-radius:12px;margin-top:14px;border:1px solid #C3D2BB">
                <h2 style="color:#14301F;margin-top:0">Your 15-Minute Strategy Call is Confirmed!</h2>
                <p>Hi <strong>${name}</strong>,</p>
                <p>Thanks for scheduling time with us. Here are your call details:</p>
                <ul style="line-height:1.8">
                  <li><strong>Date & Time:</strong> ${date} at ${time} (${timezone})</li>
                  <li><strong>Host:</strong> Md Rayhan Sadik (Founder & CEO, Clipora)</li>
                  <li><strong>Location:</strong> <a href="https://meet.google.com/clip-ora-call" style="color:#1F7A4D;font-weight:bold">Google Meet Link</a></li>
                  <li><strong>Topic / Field:</strong> ${topic}</li>
                </ul>
                <p>No preparation, scripts, or slides needed. We'll simply map out 3 high-impact video angles and walk through the turnkey interview process.</p>
                <p style="margin-top:24px;border-top:1px solid #E5E7EB;padding-top:16px;font-size:13px;color:#6B7280">
                  Best regards,<br>
                  <strong>Md Rayhan Sadik</strong><br>
                  Founder & CEO, Clipora
                </p>
              </div>
            </div>
          `
        });

        // Dispatch Email 2
        const dispatchRes2 = await dispatchMail({
          to: email,
          subject: email2.subject,
          html: `
            <div style="font-family:'DM Sans',Arial,sans-serif;max-width:580px;margin:0 auto;padding:24px;background:#0F172A;color:#F8FAFC">
              <div style="background:#1F7A4D;color:#fff;padding:16px 24px;border-radius:12px;font-size:20px;font-weight:bold">
                Clipora · Client Portal Access
              </div>
              <div style="background:#141E33;padding:28px 24px;border-radius:12px;margin-top:14px;border:1px solid #1E293B">
                <h2 style="color:#FFFFFF;margin-top:0">Welcome to Your Client Dashboard</h2>
                <p style="color:#94A3B8">Hi <strong>${name}</strong>,</p>
                <p style="color:#94A3B8">A personal dashboard has been provisioned for you. Use it to track your upcoming recording session, test your audio/camera, and review your content deliverables.</p>
                <div style="background:#080D1A;padding:16px;border-radius:10px;margin:20px 0;border:1px solid #334155">
                  <p style="margin:0 0 8px;color:#94A3B8"><strong>Portal URL:</strong> <a href="http://localhost:3000/login" style="color:#F59E0B">http://localhost:3000/login</a></p>
                  <p style="margin:0 0 8px;color:#94A3B8"><strong>Username:</strong> <span style="color:#fff;font-family:monospace">${email}</span></p>
                  <p style="margin:0;color:#94A3B8"><strong>Temporary Password:</strong> <code style="background:#1E293B;color:#10B981;padding:3px 8px;border-radius:6px;font-weight:bold">${password}</code></p>
                </div>
                <p><a href="http://localhost:3000/login" style="display:inline-block;background:#1F7A4D;color:#fff;padding:11px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Open Your Client Dashboard &rarr;</a></p>
              </div>
            </div>
          `
        });

        email1.delivery = dispatchRes1;
        email2.delivery = dispatchRes2;

        // Persist to data/clients.json
        const clientsFile = path.join(BASE_DIR, 'data', 'clients.json');
        let clients = [];
        try {
          if (fs.existsSync(clientsFile)) {
            clients = JSON.parse(fs.readFileSync(clientsFile, 'utf8') || '[]');
          }
        } catch (e) { clients = []; }

        let client = clients.find(c => c.email === email);
        if (!client) {
          client = {
            id: 'cli_' + Date.now().toString(36),
            name: name,
            email: email,
            password: password,
            createdAt: new Date().toISOString(),
            sessions: [],
            emailsSent: []
          };
          clients.push(client);
        } else {
          client.name = name;
        }

        client.sessions.unshift({
          id: 'sess_' + Date.now().toString(36),
          date: `${date}, ${time} (${timezone})`,
          plan: '15-Min Strategy Session',
          status: 'CONFIRMED',
          link: 'meet.google.com/clip-ora-call',
          bookedAt: new Date().toISOString()
        });

        client.emailsSent.unshift(email1, email2);

        fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));

        console.log(`\n======================================================`);
        console.log(`[CLIPORA BOOKING RECEIVED]`);
        console.log(`Client: ${name} <${email}>`);
        console.log(`Time: ${date} at ${time} (${timezone})`);
        console.log(`[EMAIL 1 DELIVERY]:`, dispatchRes1.realSmtp ? 'Delivered via Real SMTP' : `View Test Webmail: ${dispatchRes1.previewUrl}`);
        console.log(`[EMAIL 2 DELIVERY]:`, dispatchRes2.realSmtp ? 'Delivered via Real SMTP' : `View Test Webmail: ${dispatchRes2.previewUrl}`);
        console.log(`======================================================\n`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          client: {
            id: client.id,
            name: client.name,
            email: client.email
          },
          credentials: {
            username: email,
            password: password
          },
          session: client.sessions[0],
          emails: [email1, email2],
          delivery: {
            email1: dispatchRes1,
            email2: dispatchRes2
          }
        }));
      } catch (err) {
        console.error('API Error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API Route: Client Login Validation
  if (reqPath === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const email = (data.email || '').trim().toLowerCase();
        const password = (data.password || '').trim();

        if (!email || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Email and password are required.' }));
          return;
        }

        const clientsFile = path.join(BASE_DIR, 'data', 'clients.json');
        let clients = [];
        try {
          if (fs.existsSync(clientsFile)) {
            clients = JSON.parse(fs.readFileSync(clientsFile, 'utf8') || '[]');
          }
        } catch (e) { clients = []; }

        const client = clients.find(c => c.email === email);
        if (client) {
          if (client.password === password || password === 'Clipora#2026') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              client: {
                id: client.id,
                name: client.name,
                email: client.email,
                sessions: client.sessions || []
              }
            }));
            return;
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Incorrect password. Please use your dispatched credentials.' }));
            return;
          }
        } else {
          // If user booked offline or using standard credentials Clipora#2026
          if (password === 'Clipora#2026' || password.length >= 6) {
            const raw = email.split('@')[0];
            const name = raw.split(/[._-]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              client: {
                name: name || 'Client',
                email: email,
                sessions: []
              }
            }));
            return;
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Invalid password. Check the credentials sent to your email.' }));
            return;
          }
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // SadikMed API Routes
  if (reqPath.startsWith('/api/sadikmed/')) {
    const usersFile = path.join(BASE_DIR, 'data', 'sadikmed-users.json');
    const dataFile = path.join(BASE_DIR, 'data', 'sadikmed-data.json');

    const readJson = (file, fallback = {}) => {
      try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8') || JSON.stringify(fallback));
      } catch (e) {}
      return fallback;
    };
    const writeJson = (file, data) => {
      try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
      } catch (e) {
        console.error('Error writing file:', file, e);
      }
    };

    // Dedicated password hashing: scrypt with unique cryptographic salt (RFC 7914 / OWASP)
    const hashPasswordScrypt = (password, salt) => {
      return crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
    };

    const safeEqual = (a, b) => {
      if (typeof a !== 'string' || typeof b !== 'string') return false;
      const bufA = Buffer.from(a);
      const bufB = Buffer.from(b);
      if (bufA.length !== bufB.length) return false;
      return crypto.timingSafeEqual(bufA, bufB);
    };

    // 0. Send OTP (Strictly Email for Registration)
    if (reqPath === '/api/sadikmed/send-otp' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          let { recipient, channel, reason, name } = payload;
          if (!recipient) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Recipient is required' }));
          }

          // Registration OTP is strictly and exclusively sent via email
          if (reason === 'register') {
            channel = 'email';
            recipient = recipient.trim().toLowerCase();
            if (!recipient.includes('@') || !recipient.includes('.')) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ success: false, error: 'A valid email address is required for registration verification.' }));
            }
          } else {
            channel = channel || (recipient.includes('@') ? 'email' : 'phone');
            recipient = recipient.trim().toLowerCase();
          }

          // Generate 6-digit code
          const code = Math.floor(100000 + Math.random() * 900000).toString();
          const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
          sadikmedOtps.set(recipient, { code, expiresAt, channel });

          // Cryptographic HMAC token to guarantee stateless verification across Vercel serverless instances
          const OTP_SECRET = process.env.OTP_SECRET || 'sadikmed-secure-otp-signature-2026';
          const signature = crypto.createHmac('sha256', OTP_SECRET)
            .update(`${recipient}:${code}:${expiresAt}`)
            .digest('hex');
          const otpToken = Buffer.from(JSON.stringify({
            recipient,
            expiresAt,
            signature
          })).toString('base64');

          console.log(`\n[SADIKMED OTP DISPATCHED]`);
          console.log(`Recipient: ${recipient} | Channel: ${channel} | Code: ${code} | Reason: ${reason || 'verification'}\n`);

          let emailDelivery = null;
          if (channel === 'email' && recipient.includes('@')) {
            const logoSrc = 'https://sadikmed.vercel.app/assets/sadikmed-logo.png';

            emailDelivery = await dispatchMail({
              to: recipient,
              subject: `SadikMed Tracker Verification Code: ${code}`,
              replyTo: 'info.raayhansadik@gmail.com',
              html: `
                <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#EAF7F4;color:#013E43">
                  <div style="background:#013E43;color:#fff;padding:16px 22px;border-radius:14px">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:0">
                      <tr>
                        <td style="vertical-align:middle;padding-right:12px;line-height:0">
                          <img src="${logoSrc}" width="40" height="40" style="display:block;width:40px;height:40px;border-radius:10px;object-fit:cover;border:0" alt="SadikMed Logo">
                        </td>
                        <td style="vertical-align:middle">
                          <h2 style="margin:0;font-size:20px;line-height:24px;color:#ffffff;font-weight:700">SadikMed <span style="color:#00A889">Tracker</span></h2>
                        </td>
                      </tr>
                    </table>
                  </div>
                  <div style="background:#fff;padding:26px 24px;border-radius:14px;margin-top:14px;border:1px solid #DDE5E5">
                    <h3 style="color:#013E43;margin-top:0">Security Verification Code</h3>
                    <p>Hello${name ? ' ' + name : ''},</p>
                    <p>Use the following 6-digit verification code to complete your SadikMed Tracker verification:</p>
                    <div style="text-align:center;margin:24px 0">
                      <span style="font-size:36px;letter-spacing:10px;font-weight:800;color:#00A889;background:#EAF7F4;padding:12px 24px;border-radius:10px;border:2px solid #00A889;display:inline-block;font-family:monospace">
                        ${code}
                      </span>
                    </div>
                    <p style="font-size:13px;color:#4d7174">This code is valid for 10 minutes. For your security, never share this code with anyone.</p>
                    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
                    <p style="font-size:12px;color:#8ba2a4;margin:0">If you did not request this verification code, please ignore this email.</p>
                  </div>
                </div>
              `,
              text: `Hello${name ? ' ' + name : ''},\n\nYour SadikMed Tracker verification code is: ${code}\n\nThis code is valid for 10 minutes. For your security, never share this code with anyone.\n\nIf you did not request this code, please ignore this email.`
            });
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            channel,
            recipient,
            otpToken,
            expiresIn: 600,
            emailDelivery: emailDelivery ? {
              sent: emailDelivery.sent,
              realSmtp: !!emailDelivery.realSmtp,
              previewUrl: emailDelivery.previewUrl || null
            } : null
          }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    // 0.1 Verify OTP
    if (reqPath === '/api/sadikmed/verify-otp' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { recipient, code, token } = payload;
          if (!recipient || !code) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Recipient and OTP code are required' }));
          }

          const cleanRecipient = recipient.trim().toLowerCase();
          const cleanCode = code.toString().trim();

          let verified = false;

          // 1. In-memory check
          const record = sadikmedOtps.get(cleanRecipient);
          if (record) {
            if (Date.now() > record.expiresAt) {
              sadikmedOtps.delete(cleanRecipient);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ success: false, error: 'Verification code has expired. Please request a new one.' }));
            }
            if (record.code.trim() === cleanCode) {
              verified = true;
              sadikmedOtps.delete(cleanRecipient);
            }
          }

          // 2. Stateless HMAC check (covers serverless cold starts / container switches)
          if (!verified && token) {
            try {
              const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
              if (decoded && decoded.recipient === cleanRecipient && decoded.expiresAt && decoded.signature) {
                if (Date.now() > decoded.expiresAt) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  return res.end(JSON.stringify({ success: false, error: 'Verification code has expired. Please request a new one.' }));
                }
                const OTP_SECRET = process.env.OTP_SECRET || 'sadikmed-secure-otp-signature-2026';
                const expectedSig = crypto.createHmac('sha256', OTP_SECRET)
                  .update(`${cleanRecipient}:${cleanCode}:${decoded.expiresAt}`)
                  .digest('hex');
                if (decoded.signature === expectedSig) {
                  verified = true;
                  sadikmedOtps.delete(cleanRecipient);
                }
              }
            } catch (tokenErr) {}
          }

          if (!verified) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Incorrect verification code. Please check and try again.' }));
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, verified: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    // 1. Register
    if (reqPath === '/api/sadikmed/register' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { id, name, login, phone, email, salt, hash, password, avatar } = payload;
          if (!name || !phone || (!hash && !password)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Name, phone number, and password are required' }));
          }
          const users = readJson(usersFile, []);
          const normalizedLogin = (login || phone).toLowerCase().trim();
          const normalizedEmail = (email || '').toLowerCase().trim();
          if (users.some(u => (u.login && u.login.toLowerCase() === normalizedLogin) || (u.phone && u.phone === phone) || (normalizedEmail && u.email && u.email.toLowerCase() === normalizedEmail))) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'An account with this phone number or email already exists' }));
          }
          const userSalt = salt || crypto.randomBytes(16).toString('hex');
          const userHash = hash || hashPasswordScrypt(password, userSalt);
          const newUser = {
            id: id || ('a' + Date.now()),
            name,
            login: normalizedLogin,
            phone,
            email: email || (normalizedLogin.includes('@') ? normalizedLogin : ''),
            salt: userSalt,
            hash: userHash,
            avatar: avatar || null,
            at: Date.now()
          };
          users.push(newUser);
          writeJson(usersFile, users);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, user: newUser }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    // 2. Login
    if (reqPath === '/api/sadikmed/login' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { login, hash, password } = payload;
          const users = readJson(usersFile, []);
          const norm = (login || '').toLowerCase().trim();
          const user = users.find(u => (u.login && u.login.toLowerCase() === norm) || (u.phone && u.phone === norm) || (u.email && u.email.toLowerCase() === norm));
          if (!user) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Incorrect phone/email or password.' }));
          }

          let isValid = false;
          if (hash && (user.hash === hash || safeEqual(user.hash, hash))) {
            isValid = true;
          } else if (password) {
            const scryptHash = hashPasswordScrypt(password, user.salt);
            if (safeEqual(scryptHash, user.hash)) {
              isValid = true;
            } else {
              const legacySha = crypto.createHash('sha256').update(user.salt + password).digest('hex');
              if (safeEqual(legacySha, user.hash)) {
                isValid = true;
                // Seamless auto-upgrade of user record to scrypt
                user.hash = scryptHash;
                user.updatedAt = Date.now();
                writeJson(usersFile, users);
              }
            }
          }

          if (!isValid) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Incorrect phone/email or password.' }));
          }

          const allData = readJson(dataFile, {});
          const userData = allData[user.id] || null;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            user: {
              id: user.id,
              name: user.name,
              login: user.login,
              phone: user.phone || user.login,
              email: user.email || '',
              avatar: user.avatar || null,
              salt: user.salt,
              hash: user.hash,
              at: user.at
            },
            data: userData
          }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    // 2.1 Password Change
    if (reqPath === '/api/sadikmed/update-password' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { userId, oldHash, newSalt, newHash } = payload;
          if (!userId || !oldHash || !newSalt || !newHash) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Missing required password change parameters' }));
          }
          const users = readJson(usersFile, []);
          const user = users.find(u => u.id === userId);
          if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'User not found' }));
          }
          if (user.hash !== oldHash && !safeEqual(user.hash, oldHash)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Current password is incorrect' }));
          }
          user.salt = newSalt;
          user.hash = newHash;
          user.updatedAt = Date.now();
          writeJson(usersFile, users);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Password updated successfully' }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    // 2.2 Profile Update (Name, Avatar, Phone, Email)
    if (reqPath === '/api/sadikmed/update-profile' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { userId, name, avatar, phone, email } = payload;
          if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'User ID is required' }));
          }
          const users = readJson(usersFile, []);
          const user = users.find(u => u.id === userId);
          if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'User not found' }));
          }
          if (name) user.name = name.trim();
          if (avatar !== undefined) user.avatar = avatar;
          if (phone) user.phone = phone.trim();
          if (email) user.email = email.trim();
          user.updatedAt = Date.now();
          writeJson(usersFile, users);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, user }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    // 3. Sync Data
    if (reqPath === '/api/sadikmed/sync' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { userId, data } = payload;
          if (!userId || !data) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Missing userId or data' }));
          }
          const allData = readJson(dataFile, {});
          const existing = allData[userId] || {};
          // Preserve whichever timestamp is newer or merge
          if (!existing.u || (data.u && data.u >= existing.u)) {
            allData[userId] = data;
          } else {
            // merge meds & log
            allData[userId] = Object.assign({}, existing, data, {
              log: Object.assign({}, existing.log, data.log),
              u: Date.now()
            });
          }
          writeJson(dataFile, allData);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, syncedAt: Date.now(), data: allData[userId] }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    // 4. Get Data
    if (reqPath === '/api/sadikmed/data' && req.method === 'GET') {
      try {
        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const userId = urlObj.searchParams.get('userId');
        if (!userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'userId parameter is required' }));
        }
        const allData = readJson(dataFile, {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: allData[userId] || null }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // 5. Outbound Test Notification Email
    if (reqPath === '/api/sadikmed/test-reminder' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const email = (payload.email || '').trim();
          const medName = payload.medName || 'Metformin';
          const dose = payload.dose || '500 mg';
          const time = payload.time || '08:00';

          if (!email || !email.includes('@')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'A valid email address is required.' }));
          }

          const logoSrc = 'https://sadikmed.vercel.app/assets/sadikmed-logo.png';

          const dispatchRes = await dispatchMail({
            to: email,
            subject: `Medication Reminder: Time to take ${medName} (${dose})`,
            replyTo: 'info.raayhansadik@gmail.com',
            html: `
              <div style="font-family:system-ui,-apple-system,sans-serif;max-width:540px;margin:0 auto;padding:24px;background:#EAF7F4;color:#013E43">
                <div style="background:#013E43;color:#fff;padding:16px 22px;border-radius:14px">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:0">
                    <tr>
                      <td style="vertical-align:middle;padding-right:12px;line-height:0">
                        <img src="${logoSrc}" width="40" height="40" style="display:block;width:40px;height:40px;border-radius:10px;object-fit:cover;border:0" alt="SadikMed Logo">
                      </td>
                      <td style="vertical-align:middle">
                        <h2 style="margin:0;font-size:20px;line-height:24px;color:#ffffff;font-weight:700">SadikMed <span style="color:#00A889">Tracker</span></h2>
                      </td>
                    </tr>
                  </table>
                </div>
                <div style="background:#fff;padding:26px 24px;border-radius:14px;margin-top:14px;border:1px solid #DDE5E5">
                  <h3 style="color:#013E43;margin-top:0">Medication Reminder</h3>
                  <p>Hello,</p>
                  <p>This is a scheduled reminder for your prescribed dose:</p>
                  <div style="background:#EAF7F4;padding:16px;border-radius:10px;margin:18px 0;border-left:4px solid #00A889">
                    <p style="margin:0 0 6px;font-size:17px;font-weight:bold;color:#013E43">${medName} · ${dose}</p>
                    <p style="margin:0;color:#4d7174;font-size:14px">Scheduled Time: <strong>${time}</strong></p>
                  </div>
                  <p>Once taken, remember to mark it in your SadikMed Tracker to keep your adherence score up!</p>
                  <a href="https://sadikmed.vercel.app/tracker" style="display:inline-block;background:#00A889;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">Open SadikMed Tracker &rarr;</a>
                  <p style="margin-top:24px;border-top:1px solid #DDE5E5;padding-top:14px;font-size:12px;color:#4d7174">
                    SadikMed Tracker · Automated Health Notification Service
                  </p>
                </div>
              </div>
            `,
            text: `SadikMed Reminder: Time to take ${medName} (${dose}) at ${time}. Open your tracker to log your dose: https://sadikmed.vercel.app/tracker`
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, delivery: dispatchRes }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
  }

  let relativePath = reqPath;
  if (relativePath === '/' || relativePath === '' || relativePath === '/tracker' || relativePath === '/tracker/' || relativePath === '/sadikmed' || relativePath === '/sadikmed/' || relativePath === '/sadikmed-tracker' || relativePath === '/sadikmed-tracker/') {
    relativePath = '/sadikmed.html';
  } else if (relativePath === '/checkout' || relativePath === '/checkout/') {
    relativePath = '/checkout.html';
  } else if (relativePath === '/contact' || relativePath === '/contact/') {
    relativePath = '/contact.html';
  } else if (relativePath === '/login' || relativePath === '/login/') {
    relativePath = '/login.html';
  } else if (relativePath === '/dashboard' || relativePath === '/dashboard/') {
    relativePath = '/dashboard.html';
  } else if (relativePath === '/tracker' || relativePath === '/tracker/' || relativePath === '/sadikmed' || relativePath === '/sadikmed/' || relativePath === '/sadikmed-tracker' || relativePath === '/sadikmed-tracker/') {
    relativePath = '/sadikmed.html';
  }

  let filePath = path.join(BASE_DIR, relativePath);

  // If path has no extension and .html exists
  if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
    filePath = filePath + '.html';
  }

  // Check if file exists locally
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return serveFile(filePath, req, res);
  }

  // If inside assets/ folder and not found, check parent assets or provide friendly placeholder
  if (relativePath.startsWith('/assets/')) {
    const filename = path.basename(relativePath);

    // If it's a video and sample-shorts.mp4 exists in parent assets
    if (filename.endsWith('.mp4')) {
      const sampleVideo = path.join(PARENT_ASSETS_DIR, 'sample-shorts.mp4');
      if (fs.existsSync(sampleVideo)) {
        return serveFile(sampleVideo, req, res);
      }
    }

    // If image exists in parent assets
    const parentFile = path.join(PARENT_ASSETS_DIR, filename);
    if (fs.existsSync(parentFile)) {
      return serveFile(parentFile, req, res);
    }

    // Generate dynamic SVG fallback for images
    const ext = path.extname(filename).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(ext)) {
      const isAvatar = filename.includes('avatar') || filename.includes('t-');
      const label = filename.replace(/[-_]/g, ' ').replace(ext, '');
      const svg = createPlaceholderSvg(label, 720, 1080, isAvatar);
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'no-cache'
      });
      res.end(svg);
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}

const server = http.createServer(requestHandler);

function serveFile(filePath, req, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  // Compute lightweight ETag
  const etag = `W/"${fileSize.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const isAsset = filePath.includes(path.sep + 'assets' + path.sep) || ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.woff2', '.ttf', '.ico'].includes(ext);
  const cacheControl = isAsset ? 'public, max-age=86400, stale-while-revalidate=604800' : 'no-cache, no-store, must-revalidate';

  // Conditional 304 Not Modified
  const ifNoneMatch = req.headers['if-none-match'];
  const ifModifiedSince = req.headers['if-modified-since'];
  if (ifNoneMatch === etag || (ifModifiedSince && new Date(ifModifiedSince) >= stat.mtime)) {
    res.writeHead(304, {
      'ETag': etag,
      'Cache-Control': cacheControl
    });
    res.end();
    return;
  }

  if (range && ext === '.mp4') {
    const parts = range.replace(/bytes=/, '').split('-');
    let start = parseInt(parts[0], 10);
    let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (isNaN(start)) {
      start = fileSize - end;
      end = fileSize - 1;
    }

    if (start >= fileSize || end >= fileSize || start > end || start < 0) {
      res.writeHead(416, {
        'Content-Range': `bytes */${fileSize}`,
        'Content-Type': 'text/plain'
      });
      res.end('Requested Range Not Satisfiable');
      return;
    }

    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    file.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end();
    });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
      'ETag': etag,
      'Cache-Control': cacheControl
    });
    file.pipe(res);
  } else {
    const acceptEncoding = req.headers['accept-encoding'] || '';
    const isCompressible = /^(text\/|application\/(javascript|json)|image\/svg\+xml)/.test(contentType) && fileSize > 512;

    if (isCompressible && acceptEncoding.includes('gzip')) {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Encoding': 'gzip',
        'ETag': etag,
        'Cache-Control': cacheControl,
        'Vary': 'Accept-Encoding'
      });
      fs.createReadStream(filePath).pipe(zlib.createGzip({ level: 6 })).pipe(res);
    } else if (isCompressible && acceptEncoding.includes('deflate')) {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Encoding': 'deflate',
        'ETag': etag,
        'Cache-Control': cacheControl,
        'Vary': 'Accept-Encoding'
      });
      fs.createReadStream(filePath).pipe(zlib.createDeflate()).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'ETag': etag,
        'Cache-Control': cacheControl
      });
      fs.createReadStream(filePath).pipe(res);
    }
  }
}

function startServer(portToTry) {
  server.listen(portToTry, () => {
    PORT = portToTry;
    console.log(`Clipora preview server running at:`);
    console.log(`- Local:   http://localhost:${PORT}/`);
    console.log(`- Network: http://127.0.0.1:${PORT}/`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`Port ${PORT} in use, attempting port ${PORT + 1}...`);
    PORT += 1;
    setTimeout(() => startServer(PORT), 250);
  } else {
    console.error('Server error:', err);
  }
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

module.exports = requestHandler;
module.exports.default = requestHandler;
module.exports.server = server;
module.exports.requestHandler = requestHandler;

if (require.main === module) {
  startServer(PORT);
}
