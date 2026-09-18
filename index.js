const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// সার্ভার স্ট্যাটাস চেক করার জন্য
app.get('/', (req, res) => { res.send('WhatsApp Bot is online and running!'); });

app.listen(port, () => { 
    console.log(`Server is running on port: ${port}`); 
});

// হোয়াটসঅ্যাপ ক্লায়েন্ট কনফিগারেশন
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        // রেন্ডার সার্ভারের জন্য প্রয়োজনীয় আর্গুমেন্ট
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', 
            '--disable-gpu'
        ],
    }
});

// কিউআর কোড জেনারেশন
client.on('qr', (qr) => {
    console.log('নিচের QR কোডটি আপনার হোয়াটসঅ্যাপ দিয়ে স্ক্যান করুন:');
    qrcode.generate(qr, {small: true});
});

// সফলভাবে কানেক্ট হলে
client.on('ready', () => {
    console.log('WhatsApp Connected Successfully!');
});

// এসএমএস পাঠানোর এপিআই এন্ডপয়েন্ট
app.get('/send', (req, res) => {
    const number = req.query.number;
    const message = req.query.msg;

    if(!number || !message) {
        return res.send('Error: number and msg required. Example: /send?number=017xx&msg=Hello');
    }

    // নম্বর ফরম্যাট ঠিক করা (88 যোগ করা)
    const chatId = `88${number}@c.us`;

    client.sendMessage(chatId, message)
        .then(() => {
            res.json({ status: 'success', message: 'Message Sent!' });
        })
        .catch(err => {
            res.json({ status: 'error', message: err.message });
        });
});

client.initialize();
