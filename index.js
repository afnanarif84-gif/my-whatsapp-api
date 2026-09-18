const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => { res.send('Bot is online!'); });
app.listen(port, () => { console.log(`Port: ${port}`); });

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.generate(qr, {small: true});
});

client.on('ready', () => {
    console.log('WhatsApp Connected!');
});

// এসএমএস পাঠানোর এপিআই লিঙ্ক
app.get('/send', (req, res) => {
    const number = req.query.number;
    const message = req.query.msg;
    if(!number || !message) return res.send('Error: number and msg required');

    client.sendMessage(`88${number}@c.us`, message)
        .then(() => res.send('Message Sent!'))
        .catch(err => res.send('Failed: ' + err));
});

client.initialize();
