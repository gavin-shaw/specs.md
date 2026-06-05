const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function writeFileAtomic(targetPath, contents) {
    if (typeof targetPath !== 'string' || targetPath.trim() === '') {
        throw new Error('writeFileAtomic: targetPath is required');
    }

    const directory = path.dirname(targetPath);
    const tempPath = path.join(
        directory,
        `.${path.basename(targetPath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
    );

    fs.writeFileSync(tempPath, contents);
    try {
        fs.renameSync(tempPath, targetPath);
    } catch (err) {
        try {
            fs.unlinkSync(tempPath);
        } catch {
            // temp file already gone; nothing to clean up
        }
        throw err;
    }
}

module.exports = { writeFileAtomic };
