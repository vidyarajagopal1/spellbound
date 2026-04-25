const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'docs', 'sw.js'));
});

app.use(express.static(path.join(__dirname, 'docs')));

app.listen(PORT, () => {
  console.log(`Spellbound running at http://localhost:${PORT}`);
});
