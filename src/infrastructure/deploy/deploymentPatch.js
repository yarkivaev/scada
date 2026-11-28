function aliasChange(env, path, rename) {
    if (!rename) { return null; }
    const { aliases, name } = rename;
    const index = env.findIndex((row) => { return aliases.includes(row.name); });
    if (index < 0) { return null; }
    if (env[index].name !== name) { return { op: 'replace', path: `${path}/${index}/name`, value: name }; }
    const duplicate = env.findIndex((row, other) => { return index !== other && aliases.includes(row.name); });
    return duplicate < 0 ? null : { op: 'remove', path: `${path}/${duplicate}` };
}

function envChange(container, path, name, value) {
    const env = container.env ?? [];
    const item = { name, value };
    if (!container.env) { return { op: 'add', path, value: [item] }; }
    const index = env.findIndex((row) => { return row.name === name; });
    if (index < 0) { return { op: 'add', path: `${path}/-`, value: item }; }
    if (env[index].value === value && !env[index].valueFrom) { return null; }
    if (env[index].valueFrom) { return { op: 'replace', path: `${path}/${index}`, value: item }; }
    return { op: 'replace', path: `${path}/${index}/value`, value };
}

/** Select one change so each deployment update can be recomputed from fresh state. */
export default function deploymentPatch(body, { containerIndex = 0, rename, environment = {}, replicas }) {
    const container = body.spec.template.spec.containers[containerIndex];
    const path = `/spec/template/spec/containers/${containerIndex}/env`;
    const alias = aliasChange(container.env ?? [], path, rename);
    if (alias) { return alias; }
    for (const [name, value] of Object.entries(environment)) {
        if (value !== undefined) {
            const op = envChange(container, path, name, value);
            if (op) { return op; }
        }
    }
    return Number.isInteger(replicas) && body.spec.replicas !== replicas
        ? { op: Object.hasOwn(body.spec, 'replicas') ? 'replace' : 'add', path: '/spec/replicas', value: replicas } : null;
}
