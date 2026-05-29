#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const roots = ['src/domain', 'src/application', 'src/infrastructure'];
const banned = /(?:Handler|Router|Publisher|Engine|Mapper)\b/u;
const erSuffix = /export default function \w+er\b/u;

function walk(dir, files = []) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            if (name.endsWith('er')) {
                process.stderr.write(`EO violation: folder ends with -er: ${path}\n`);
                process.exitCode = 1;
            } else {
                walk(path, files);
            }
        } else if (path.endsWith('.js')) {
            files.push(path);
        }
    }
    return files;
}

const base = new URL('..', import.meta.url).pathname;
for (const root of roots) {
    const dir = join(base, root);
    try {
        for (const file of walk(dir)) {
            const text = readFileSync(file, 'utf8');
            if (banned.test(text)) {
                process.stderr.write(`EO violation: banned suffix in ${file}\n`);
                process.exitCode = 1;
            }
            if (erSuffix.test(text)) {
                process.stderr.write(`EO violation: factory name ends with -er in ${file}\n`);
                process.exitCode = 1;
            }
        }
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }
    }
}

if (process.exitCode) {
    process.exit(process.exitCode);
}
