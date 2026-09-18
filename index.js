const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => { res.send('Bot is online!'); });
app.listen(port, () => { console.log(`Server running on port ${port}`); });

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        // এখানে ভেরিয়েবল থেকে পাথটি নেওয়া হচ্ছে
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
    }
});

client.on('qr', (qr) => {
    console.log('নিচের QR কোডটি স্ক্যান করুন:');
    qrcode.generate(qr, {small: true});
});

client.on('ready', () => {
    console.log('WhatsApp Connected!');
});

app.get('/send', (req, res) => {
    const number = req.query.number;
    const message = req.query.msg;
    if(!number || !message) return res.send('Error: number and msg required');

    client.sendMessage(`88${number}@c.us`, message)
        .then(() => res.send('Message Sent!'))
        .catch(err => res.send('Failed: ' + err));
});

client.initialize();
