import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import readDocument from './readDocument.js';

/** Load one deployment document and resolve its includes beside the root document. */
export default function readDocumentFile(file, parse = readDocument) {
    const path = file instanceof URL ? fileURLToPath(file) : file;
    const directory = dirname(path);
    return parse(readFileSync(path, 'utf8'), (name) => {
        return readFileSync(join(directory, name), 'utf8');
    });
}

/** Apply only declared boolean options when a deployment document selects a phase. */
export function selectDeploymentPhase(document, { selection, section, fields, label = section }) {
    if (document[selection] === undefined) { return document; }
    const configuration = document[section];
    const phases = configuration?.phases;
    const name = document[selection];
    const selected = phases && Object.hasOwn(phases, name) ? phases[name] : undefined;
    if (!selected || typeof selected !== 'object' || Array.isArray(selected)
        || fields.some((field) => { return !Object.hasOwn(selected, field); })
        || Object.entries(selected).some(([key, value]) => { return !fields.includes(key) || typeof value !== 'boolean'; })) {
        throw new TypeError(`Invalid ${label} phase`);
    }
    return { ...document, [section]: { ...configuration, ...selected } };
}
