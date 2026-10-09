import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute } from '../worker.js';
const directory = await mkdtemp(join(tmpdir(), 'sesame-akshare-live-'));
const context = { directory, signal: AbortSignal.timeout(600000), pythonPath: process.env.SESAME_AKSHARE_PYTHON };
try {
    const prepared = await execute({ operation: 'prepare' }, context);
    console.log(JSON.stringify({ prepared: true, python: prepared.receipt.python, version: prepared.receipt.akshareVersion, packages: prepared.receipt.packages.length }));
    let successes = 0;
    for (const [name, args] of [['stock_info_a_code_name', {}], ['stock_zh_a_hist', { symbol: '000001', period: 'daily', start_date: '20240901', end_date: '20240930', adjust: '' }], ['stock_zh_a_daily', { symbol: 'sz000001', start_date: '20240901', end_date: '20240930', adjust: '' }]]) {
        try {
            const result = await execute({ operation: 'query', interface: name, arguments: args }, context);
            console.log(JSON.stringify({ interface: name, rows: result.rows.length, sample: result.rows.slice(0, 2), observedAt: result.observedAt }));
            if (!result.rows.length)
                process.exitCode = 1;
            else
                successes++;
        }
        catch (e) {
            console.log(JSON.stringify({ interface: name, error: e.message }));
        }
    }
    if (successes < 2)
        process.exitCode = 1;
}
finally {
    await rm(directory, { recursive: true, force: true });
}
