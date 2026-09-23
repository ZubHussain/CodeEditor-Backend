const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');
const os = require('os');

const app = express();
const PORT = 8080;

app.use(cors());
app.use(express.json());

// Mapping languages to their respective Docker images, file extensions, and commands
const CONFIG = {
    python: {
        image: 'python:3.10-alpine',
        filename: 'main.py',
        runCmd: 'python main.py',
        isCompiled: false
    },
    javascript: {
        image: 'node:18-alpine',
        filename: 'main.js',
        runCmd: 'node main.js',
        isCompiled: false
    },
    java: {
        image: 'eclipse-temurin:21-jdk-alpine',
        filename: 'Main.java',
        compileCmd: 'javac Main.java',
        runCmd: 'java Main',
        isCompiled: true
    },
    cpp: {
        image: 'gcc:latest',
        filename: 'main.cpp',
        compileCmd: 'g++ main.cpp -o main',
        runCmd: './main',
        isCompiled: true
    }
};

/**
 * Executes a shell command and optionally pipes input to stdin.
 * Resolves with { error, stdout, stderr } instead of rejecting, to handle custom errors.
 */
const runCommand = (command, input = '', timeoutMs = 10000) => {
    return new Promise((resolve) => {
        const child = exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
            resolve({ error, stdout, stderr });
        });

        if (child.stdin) {
            // Ensure input ends with a newline so sc.nextInt() / sc.nextLine() completes cleanly
            const formattedInput = input ? (input.endsWith('\n') ? input : input + '\n') : '\n';
            child.stdin.write(formattedInput);
            child.stdin.end();
        }
    });
};

app.post('/api/v1/execute', async (req, res) => {
    const startTime = Date.now();
    const { language, code, testCases } = req.body;

    // Validate inputs
    if (!CONFIG[language]) {
        return res.status(400).json({ overallStatus: 'ERROR', results: [], executionTimeMs: 0 });
    }

    const langConfig = CONFIG[language];
    const executionId = crypto.randomUUID();
    
    // Create an isolated temporary directory for this specific execution
    const baseTempDir = path.join(os.tmpdir(), 'rce-executions');
    const executionDir = path.join(baseTempDir, executionId);

    try {
        await fs.mkdir(executionDir, { recursive: true });
        const filePath = path.join(executionDir, langConfig.filename);
        await fs.writeFile(filePath, code);

        let overallStatus = 'ACCEPTED';
        const results = [];

        // Base Docker command parameters (Memory Limit, No Internet, Mount Dir)
// In index.js
        const baseDockerRun = `docker run -i --rm --network none -m 256m -v "${executionDir}":/app -w /app ${langConfig.image}`;
        if (langConfig.isCompiled) {
            const compileCommand = `${baseDockerRun} ${langConfig.compileCmd}`;
            const { error, stderr } = await runCommand(compileCommand, '', 10000); // 10s timeout for compilation

            if (error) {
                // Compilation Failed
                for (let i = 0; i < testCases.length; i++) {
                    results.push({
                        status: 'ERROR',
                        expectedOutput: testCases[i].expectedOutput,
                        actualOutput: '',
                        errorOutput: stderr || error?.message || 'Compilation Error'
                    });
                }
                
                // Cleanup and return early
                await fs.rm(executionDir, { recursive: true, force: true });
                return res.json({
                    overallStatus: 'ERROR',
                    results,
                    executionTimeMs: Date.now() - startTime
                });
            }
        }

        // Run the code against each test case sequentially
        for (const tc of testCases) {
            const runCommandStr = `${baseDockerRun} ${langConfig.runCmd}`;
            
            // Execute the container, passing the test case input directly into stdin
            const { error, stdout, stderr } = await runCommand(runCommandStr, tc.input, 5000);

            let status = 'ACCEPTED';
            let actualOutput = stdout ? stdout.trim() : '';
            const expectedOutput = tc.expectedOutput ? tc.expectedOutput.trim() : '';
            const errorOutput = stderr ? stderr.trim() : '';

            // ✅ SAFE ACCESS: Check error?.killed with optional chaining
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

        // Delete the temporary directory and all files inside
        await fs.rm(executionDir, { recursive: true, force: true });

        // Send the final evaluated payload back to the React frontend
        res.json({
            overallStatus: overallStatus,
            results: results,
            executionTimeMs: Date.now() - startTime
        });

    } catch (error) {
        console.error('Execution Error:', error);
        // Ensure cleanup happens even if something goes horribly wrong
        await fs.rm(executionDir, { recursive: true, force: true }).catch(() => {});
        
        res.status(500).json({
            overallStatus: 'SERVER_ERROR',
            results: [],
            executionTimeMs: Date.now() - startTime
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Node.js RCE Backend running on http://localhost:${PORT}`);
});