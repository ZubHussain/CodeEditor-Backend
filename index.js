const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Mapping languages to native system binaries and file configurations
const CONFIG = {
    python: {
        filename: 'main.py',
        runCmd: 'python3 main.py',
        isCompiled: false
    },
    javascript: {
        filename: 'main.js',
        runCmd: 'node main.js',
        isCompiled: false
    },
    java: {
        filename: 'Main.java',
        compileCmd: 'javac Main.java',
        runCmd: 'java Main',
        isCompiled: true
    },
    cpp: {
        filename: 'main.cpp',
        compileCmd: 'g++ main.cpp -o main',
        runCmd: './main',
        isCompiled: true
    }
};

/**
 * Executes a native shell command inside a specified working directory.
 */
const runCommand = (command, executionDir, input = '', timeoutMs = 5000) => {
    return new Promise((resolve) => {
        const child = exec(
            command,
            { cwd: executionDir, timeout: timeoutMs },
            (error, stdout, stderr) => {
                resolve({ error, stdout, stderr });
            }
        );

        if (child.stdin) {
            const formattedInput = input ? (input.endsWith('\n') ? input : input + '\n') : '\n';
            child.stdin.write(formattedInput);
            child.stdin.end();
        }
    });
};

app.post('/api/v1/execute', async (req, res) => {
    const startTime = Date.now();
    const { language, code, testCases } = req.body;

    if (!CONFIG[language]) {
        return res.status(400).json({ overallStatus: 'ERROR', results: [], executionTimeMs: 0 });
    }

    const langConfig = CONFIG[language];
    const executionId = crypto.randomUUID();
    
    // Create isolated temporary directory
    const baseTempDir = path.join(os.tmpdir(), 'rce-executions');
    const executionDir = path.join(baseTempDir, executionId);

    try {
        await fs.mkdir(executionDir, { recursive: true });
        const filePath = path.join(executionDir, langConfig.filename);
        await fs.writeFile(filePath, code);

        let overallStatus = 'ACCEPTED';
        const results = [];

        // 1. Compilation Phase (if required)
        if (langConfig.isCompiled) {
            const { error, stderr } = await runCommand(langConfig.compileCmd, executionDir, '', 10000);

            if (error) {
                for (let i = 0; i < (testCases?.length || 1); i++) {
                    results.push({
                        status: 'ERROR',
                        expectedOutput: testCases?.[i]?.expectedOutput || '',
                        actualOutput: '',
                        errorOutput: stderr || error?.message || 'Compilation Error'
                    });
                }
                
                await fs.rm(executionDir, { recursive: true, force: true });
                return res.json({
                    overallStatus: 'ERROR',
                    results,
                    executionTimeMs: Date.now() - startTime
                });
            }
        }

        // 2. Execution Phase against test cases
        for (const tc of testCases) {
            const { error, stdout, stderr } = await runCommand(langConfig.runCmd, executionDir, tc.input, 5000);

            let status = 'ACCEPTED';
            let actualOutput = stdout ? stdout.trim() : '';
            const expectedOutput = tc.expectedOutput ? tc.expectedOutput.trim() : '';
            const errorOutput = stderr ? stderr.trim() : '';

            const isTimedOut = Boolean(error?.killed);

            if (error) {
                status = 'ERROR';
                overallStatus = 'ERROR';
                if (isTimedOut) {
                    actualOutput = '';
                }
            } else if (actualOutput !== expectedOutput) {
                status = 'WRONG_ANSWER';
                if (overallStatus === 'ACCEPTED') {
                    overallStatus = 'WRONG_ANSWER';
                }
            }

            results.push({
                status: status,
                expectedOutput: expectedOutput,
                actualOutput: actualOutput,
                errorOutput: isTimedOut ? 'Time Limit Exceeded (5000ms)' : (errorOutput || error?.message || '')
            });
        }

        // Cleanup temporary workspace
        await fs.rm(executionDir, { recursive: true, force: true });

        res.json({
            overallStatus: overallStatus,
            results: results,
            executionTimeMs: Date.now() - startTime
        });

    } catch (error) {
        console.error('Execution Error:', error);
        await fs.rm(executionDir, { recursive: true, force: true }).catch(() => {});
        
        res.status(500).json({
            overallStatus: 'SERVER_ERROR',
            results: [],
            executionTimeMs: Date.now() - startTime
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Native RCE Backend running on port ${PORT}`);
});