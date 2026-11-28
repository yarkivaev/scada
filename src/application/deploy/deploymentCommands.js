function entries(configuration, plugins) {
    if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
        throw new TypeError('Deployment commands must be a mapping');
    }
    return new Map(Object.entries(configuration).map(([name, declaration]) => {
        const plugin = Object.hasOwn(plugins, declaration?.plugin) ? plugins[declaration.plugin] : undefined;
        if (!plugin) { throw new TypeError(`Unknown deployment plugin for ${name}`); }
        const methods = new Map(['plan', 'deploy'].filter((method) => {
            return declaration[method] === true;
        }).map((method) => {
            if (typeof plugin[method] !== 'function') {
                throw new TypeError(`Deployment plugin ${declaration.plugin} does not implement ${method}`);
            }
            return [method, plugin[method].bind(plugin)];
        }));
        if (!methods.size) { throw new TypeError(`Deployment command ${name} has no actions`); }
        return [name, methods];
    }));
}

/** Selects deployment ports from modules registered by the application. */
export default function deploymentCommands(configuration, plugins) {
    const commands = entries(configuration, plugins);
    return function run(name, method, options) {
        const command = commands.get(name)?.get(method);
        if (!command) { throw new TypeError(`Unsupported deployment command ${name} ${method}`); }
        return command(options);
    };
}
