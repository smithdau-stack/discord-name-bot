const fs = require('fs');
const { execSync } = require('child_process');

const creds = JSON.stringify(require('./credentials.json'));
execSync(`flyctl secrets set GOOGLE_CREDENTIALS=${JSON.stringify(creds)}`, { 
  stdio: 'inherit',
  shell: true 
});
console.log('Done!');