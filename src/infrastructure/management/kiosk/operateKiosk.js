import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import shellArgument from './shellArgument.js';

const audio = new URL('./kiosk-volume.sh', import.meta.url);
const browser = new URL('./kiosk-browser.py', import.meta.url);

function credential(file, encoding) {
    if (!file) { return null; }
    const value = readFileSync(file, 'utf8').trimEnd();
    return encoding === 'base64' ? Buffer.from(value, 'base64').toString('utf8') : value;
}

function between(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
}

function validate(plan, action) {
    if (!['check', 'apply', 'reload'].includes(action)) { throw new TypeError('Unknown kiosk action'); }
    if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(plan.host) || !isIP(plan.nodeAddress)
        || !/^[a-z_][a-z0-9_-]*$/u.test(plan.audioUser)
        || !between(plan.volumePercent, 0, 100) || !between(plan.audioCard, 0, 32)
        || !between(plan.debugPort, 1, 65535)) {
        throw new TypeError('Invalid kiosk target or device settings');
    }
    const url = new URL(plan.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
        throw new TypeError('Invalid kiosk page URL');
    }
    return url.href;
}

function ssh(host, { passwordFile, encoding, config, knownHosts }, execute, environment) {
    const password = credential(passwordFile, encoding);
    const program = password === null ? 'ssh' : 'sshpass';
    const args = [
        ...(password === null ? [] : ['-e', 'ssh']),
        ...(config ? ['-F', config] : []),
        ...(knownHosts ? ['-o', `UserKnownHostsFile=${knownHosts}`, '-o', 'StrictHostKeyChecking=yes'] : []),
        '-o', `BatchMode=${password === null ? 'yes' : 'no'}`, '-o', 'NumberOfPasswordPrompts=1',
        '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2', host
    ];
    return function remote(command, input) {
        return String(execute(program, [...args, command], {
            encoding: 'utf8', timeout: 45000, input,
            env: { ...environment, ...(password !== null && { SSHPASS: password }) }
        }));
    };
}

function audioResult(remote, plan, action, settings) {
    const password = credential(settings.sudoPasswordFile, settings.encoding);
    if (password?.includes('\n')) { throw new Error('Multiline sudo credential is not supported'); }
    const env = `env KIOSK_AUDIO_ACTION=${action} VOLUME_PERCENT=${plan.volumePercent} KIOSK_USER=${plan.audioUser} AMIXER_CARD=${plan.audioCard}`;
    const source = readFileSync(audio, 'utf8');
    if (password === null) { return remote(`sudo -n ${env} bash -s`, source); }
    // Keep the credential out of the command and outside the shell source.
    return remote(`bash -c 'IFS= read -r scada_password; scada_script=$(cat); printf "%s\\n" "$scada_password" | sudo -k -S -p "" ${env} bash -c "$scada_script"'`,
        `${password}\n${source}`);
}

/** Check the declared host before operating its local mixer or browser. */
export default function operateKiosk(plan, action, { execute = execFileSync, environment = process.env, ssh: settings = {} } = {}) {
    const url = validate(plan, action);
    const remote = ssh(plan.host, settings, execute, environment);
    if (!remote('hostname -I').trim().split(/\s+/u).includes(plan.nodeAddress)) {
        throw new Error('Kiosk host identity differs from DSL target');
    }
    const results = [];
    if (action !== 'reload') { results.push(audioResult(remote, plan, action, settings)); }
    results.push(remote(`python3 - ${action === 'reload' ? 'reload' : 'check'} ${plan.debugPort} ${shellArgument(url)}`, readFileSync(browser, 'utf8')));
    return results.join('\n');
}
