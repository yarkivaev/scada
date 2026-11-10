import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const chart = fileURLToPath(new URL('../../charts/scada', import.meta.url));
function render(postgres, env = []) {
    const output = execFileSync('helm',['template','edge',chart,'-f','-'],{
        encoding:'utf8',stdio:['pipe','pipe','pipe'],input:JSON.stringify({image:'example.invalid/app:1',
            rabbitmq:{enabled:false},postgres,env})
    });
    return yaml.loadAll(output).filter(Boolean);
}
function containers(documents) {
    return documents.filter((document) => { return document.kind === 'Deployment'; })
        .flatMap((document) => { return document.spec.template.spec.containers; });
}
function postgresEnv(container) {
    return container.env.filter(({name}) => { return ['POSTGRES_URL','POSTGRES_ADMIN_URL','SUPERVISOR_MIGRATIONS'].includes(name); });
}
describe('PostgreSQL runtime chart credentials', function() {
    it('preserves the default administrative migration contract', function() {
        for (const container of containers(render({secret:'bootstrap-auth'}))) {
            assert.deepEqual(postgresEnv(container),[
                {name:'POSTGRES_URL',valueFrom:{secretKeyRef:{name:'bootstrap-auth',key:'url'}}},
                {name:'POSTGRES_ADMIN_URL',valueFrom:{secretKeyRef:{name:'bootstrap-auth',key:'adminUrl'}}}
            ]);
        }
    });
    it('can separate application credentials while retaining apply-mode bootstrap migrations', function() {
        for (const container of containers(render({secret:'bootstrap-auth',runtimeSecret:'runtime-auth',migrationsMode:'apply'}))) {
            assert.deepEqual(postgresEnv(container),[
                {name:'POSTGRES_URL',valueFrom:{secretKeyRef:{name:'runtime-auth',key:'url'}}},
                {name:'POSTGRES_ADMIN_URL',valueFrom:{secretKeyRef:{name:'bootstrap-auth',key:'adminUrl'}}}
            ]);
        }
    });
    it('uses only the separate runtime Secret for both application containers in verify mode', function() {
        const documents = render({secret:'bootstrap-auth',runtimeSecret:'runtime-auth',migrationsMode:'verify'});
        const applications = containers(documents);
        assert.equal(applications.length,2);
        for (const container of applications) {
            assert.deepEqual(postgresEnv(container),[
                {name:'POSTGRES_URL',valueFrom:{secretKeyRef:{name:'runtime-auth',key:'url'}}},
                {name:'SUPERVISOR_MIGRATIONS',value:'verify'}
            ]);
            assert.equal(JSON.stringify(container).includes('bootstrap-auth'),false);
        }
        const database = documents.find((document) => { return document.kind === 'StatefulSet'; });
        assert.equal(database.spec.template.spec.containers[0].env.find(({name}) => { return name === 'POSTGRES_PASSWORD'; })
            .valueFrom.secretKeyRef.name,'bootstrap-auth');
    });
    it('requires a separate runtime Secret in verify mode', function() {
        for (const runtimeSecret of ['', 'bootstrap-auth']) {
            assert.throws(() => { render({secret:'bootstrap-auth',runtimeSecret,migrationsMode:'verify'}); },/runtimeSecret/u);
        }
    });
    it('rejects unknown migration modes', function() {
        assert.throws(() => { render({migrationsMode:'skip'}); },/migrationsMode/u);
    });
    it('keeps explicitly configured external database environment intact', function() {
        const env = [{name:'POSTGRES_URL',valueFrom:{secretKeyRef:{name:'external-runtime',key:'url'}}},
            {name:'SUPERVISOR_MIGRATIONS',value:'verify'}];
        for (const container of containers(render({enabled:false,migrationsMode:'verify'},env))) {
            assert.deepEqual(postgresEnv(container),env);
        }
    });
});
