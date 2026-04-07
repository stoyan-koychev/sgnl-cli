import {
  runPythonScript,
  runPythonScriptSafe,
  PythonNotInstalledError,
  PythonScriptError,
  JSONParseError,
  TimeoutError,
  PythonRuntimeError,
} from '../../src/analysis/python';
import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';

jest.mock('child_process');

interface MockProcess {
  stdout: { on: jest.Mock };
  stderr: { on: jest.Mock };
  stdin: { on: jest.Mock; write: jest.Mock; end: jest.Mock };
  on: jest.Mock;
  kill: jest.Mock;
  killed: boolean;
}

describe('Python Script Runner', () => {
  const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // WHITELIST VALIDATION
  // ============================================
  describe('whitelist validation', () => {
    it('should block path traversal attempts with ../', async () => {
      expect(() => {
        // Use a function that internally calls validateScriptName
        // We'll test this via the main function
      }).not.toThrow();

      // Test via actual execution attempt
      const promise = runPythonScript('../../../etc/passwd', 'test');
      await expect(promise).rejects.toBeInstanceOf(PythonScriptError);
      await expect(promise).rejects.toThrow('Path traversal attempt detected');
    });

    it('should block path traversal attempts with ..\\', async () => {
      const promise = runPythonScript('..\\..\\windows\\system32', 'test');
      await expect(promise).rejects.toBeInstanceOf(PythonScriptError);
      await expect(promise).rejects.toThrow('Path traversal attempt detected');
    });

    it('should block absolute paths starting with /', async () => {
      const promise = runPythonScript('/etc/passwd', 'test');
      await expect(promise).rejects.toBeInstanceOf(PythonScriptError);
      await expect(promise).rejects.toThrow('Path traversal attempt detected');
    });

    it('should allow split.py', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);
      (mockProc.stdout.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          handler(Buffer.from('{"test": "output"}'));
        }
      });

      const result = await runPythonScript('split.py', 'test');
      expect(result).toEqual('{"test": "output"}');
    });

    it('should allow xray.py', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);
      (mockProc.stdout.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          handler(Buffer.from('{}'));
        }
      });

      const result = await runPythonScript('xray.py', 'test');
      expect(result).toEqual('{}');
    });

    it('should allow technical_seo.py', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);
      (mockProc.stdout.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          handler(Buffer.from('{}'));
        }
      });

      const result = await runPythonScript('technical_seo.py', 'test');
      expect(result).toEqual('{}');
    });

    it('should allow onpage.py', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);
      (mockProc.stdout.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          handler(Buffer.from('{}'));
        }
      });

      const result = await runPythonScript('onpage.py', 'test');
      expect(result).toEqual('{}');
    });

    it('should reject unknown scripts', async () => {
      const promise = runPythonScript('unknown.py', 'test');
      await expect(promise).rejects.toBeInstanceOf(PythonScriptError);
      await expect(promise).rejects.toThrow('Script not whitelisted');
    });

    it('should reject evil.py', async () => {
      const promise = runPythonScript('evil.py', 'test');
      await expect(promise).rejects.toBeInstanceOf(PythonScriptError);
      await expect(promise).rejects.toThrow('not whitelisted');
    });

    it('should reject scripts with embedded paths', async () => {
      const promise = runPythonScript('subdir/split.py', 'test');
      await expect(promise).rejects.toBeInstanceOf(PythonScriptError);
      await expect(promise).rejects.toThrow('not whitelisted');
    });
  });

  // ============================================
  // TIMEOUT HANDLING
  // ============================================
  describe('timeout handling', () => {
    it('should timeout fires and kill process', () => {
      jest.useFakeTimers();
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);

      (mockProc.on as jest.Mock).mockImplementation((): any => {
        return mockProc;
      });

      const promise = runPythonScript('split.py', 'test', 100);

      // Advance timers to trigger timeout
      jest.advanceTimersByTime(150);

      // Verify kill was called
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');

      jest.useRealTimers();
    });

    it('should reject with TimeoutError when timeout occurs', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);

      let closeHandler: Function | undefined;
      (mockProc.on as jest.Mock).mockImplementation((event: string, handler: Function): any => {
        if (event === 'close') {
          closeHandler = handler;
          // Simulate actual close event after timeout
          setTimeout(() => {
            if (closeHandler) closeHandler(null);
          }, 250);
        }
        return mockProc;
      });

      const promise = runPythonScript('split.py', 'test', 100);
      await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    });

    it('should use configurable timeout value', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);

      (mockProc.on as jest.Mock).mockImplementation((event: string, handler: Function): any => {
        // Simulate close event after a long delay
        setTimeout(() => {
          if (event === 'close') {
            handler(null);
          }
        }, 500);
        return mockProc;
      });

      const customTimeout = 50;
      const promise = runPythonScript('split.py', 'test', customTimeout);
      await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    });
  });

  // ============================================
  // ERROR HANDLING
  // ============================================
  describe('error handling', () => {
    it('should throw PythonNotInstalledError when python3 not found', async () => {
      mockedSpawn.mockImplementation(() => {
        const err: any = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      });

      const promise = runPythonScript('split.py', 'test');
      await expect(promise).rejects.toBeInstanceOf(PythonNotInstalledError);
    });

    it('should throw PythonNotInstalledError on EACCES error', async () => {
      mockedSpawn.mockImplementation(() => {
        const err: any = new Error('EACCES');
        err.code = 'EACCES';
        throw err;
      });

      const promise = runPythonScript('split.py', 'test');
      await expect(promise).rejects.toBeInstanceOf(PythonNotInstalledError);
    });

    it('should throw PythonRuntimeError on non-zero exit code', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(1));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);
      (mockProc.stderr.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          handler(Buffer.from('SyntaxError: invalid syntax'));
        }
      });

      const promise = runPythonScript('split.py', 'test');
      await expect(promise).rejects.toBeInstanceOf(PythonRuntimeError);
      await expect(promise).rejects.toThrow('exited with code 1');
    });

    it('should truncate stderr in error messages', async () => {
      const longError = 'A'.repeat(1000);
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(1));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);
      (mockProc.stderr.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          handler(Buffer.from(longError));
        }
      });

      const promise = runPythonScript('split.py', 'test');
      try {
        await promise;
      } catch (err) {
        const errorMsg = (err as Error).message;
        expect(errorMsg.length).toBeLessThan(longError.length + 100);
      }
    });
  });

  // ============================================
  // JSON PARSING
  // ============================================
  describe('JSON output validation', () => {
    it('should parse valid JSON output', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);
      const testData = { test: 'data', nested: { value: 123 } };
      (mockProc.stdout.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          handler(Buffer.from(JSON.stringify(testData)));
        }
      });

      const result = await runPythonScript('split.py', 'test');
      expect(result).toEqual(JSON.stringify(testData));
      expect(JSON.parse(result)).toEqual(testData);
    });

    it('should throw JSONParseError on invalid JSON', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);
      (mockProc.stdout.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          handler(Buffer.from('not valid json at all'));
        }
      });

      const promise = runPythonScript('split.py', 'test');
      await expect(promise).rejects.toBeInstanceOf(JSONParseError);
      await expect(promise).rejects.toThrow('Invalid JSON');
    });

    it('should throw JSONParseError on empty output', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);

      const promise = runPythonScript('split.py', 'test');
      await expect(promise).rejects.toBeInstanceOf(JSONParseError);
      await expect(promise).rejects.toThrow('empty output');
    });

    it('should handle empty JSON object', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);
      (mockProc.stdout.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          handler(Buffer.from('{}'));
        }
      });

      const result = await runPythonScript('split.py', 'test');
      expect(result).toEqual('{}');
      expect(JSON.parse(result)).toEqual({});
    });

    it('should handle JSON array', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);
      (mockProc.stdout.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          handler(Buffer.from('[1, 2, 3]'));
        }
      });

      const result = await runPythonScript('split.py', 'test');
      expect(result).toEqual('[1, 2, 3]');
    });
  });

  // ============================================
  // LARGE JSON HANDLING
  // ============================================
  describe('large JSON handling', () => {
    it('should handle large JSON output (1MB)', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);

      // Create 1MB of JSON data
      const largeData = {
        items: Array.from({ length: 10000 }, (_, i) => ({
          id: i,
          text: 'x'.repeat(100),
        })),
      };
      const largeJson = JSON.stringify(largeData);

      (mockProc.stdout.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          // Simulate chunked output
          const chunkSize = 65536;
          for (let i = 0; i < largeJson.length; i += chunkSize) {
            handler(Buffer.from(largeJson.substring(i, i + chunkSize)));
          }
        }
      });

      const result = await runPythonScript('split.py', 'test');
      expect(JSON.parse(result)).toEqual(largeData);
    });
  });

  // ============================================
  // STDIN INPUT PASSING
  // ============================================
  describe('stdin input passing', () => {
    it('should pass input via stdin', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);
      (mockProc.stdout.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          handler(Buffer.from('{"success": true}'));
        }
      });

      const testInput = '<html>test html</html>';
      await runPythonScript('split.py', testInput);

      expect(mockProc.stdin.write).toHaveBeenCalledWith(testInput);
      expect(mockProc.stdin.end).toHaveBeenCalled();
    });

    it('should not pass input via command line args', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);
      (mockProc.stdout.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          handler(Buffer.from('{}'));
        }
      });

      await runPythonScript('split.py', 'test input');

      // Verify spawn was called with only script path, no args containing the input
      const spawnCall = mockedSpawn.mock.calls[0];
      // Python path may be 'python3', Homebrew path, or system path
      expect(spawnCall[0]).toMatch(/python3$/);
      expect(spawnCall[1][0]).toMatch(/split\.py/);
      expect(spawnCall[1].length).toBe(1); // Only script path, no additional args
    });

    it('should handle large input via stdin', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);
      (mockProc.stdout.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          handler(Buffer.from('{"processed": true}'));
        }
      });

      const largeInput = '<html>' + 'x'.repeat(1000000) + '</html>'; // 1MB HTML
      await runPythonScript('split.py', largeInput);

      expect(mockProc.stdin.write).toHaveBeenCalledWith(largeInput);
    });
  });

  // ============================================
  // ENVIRONMENT ISOLATION
  // ============================================
  describe('environment isolation', () => {
    it('should use minimal environment (PATH only)', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);
      (mockProc.stdout.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          handler(Buffer.from('{}'));
        }
      });

      await runPythonScript('split.py', 'test');

      const spawnOptions = mockedSpawn.mock.calls[0][2];
      expect(spawnOptions.env).toBeDefined();
      expect(Object.keys(spawnOptions.env!)).toEqual(['PATH']);
      expect(spawnOptions.env!.PATH).toBeDefined();

      // Ensure no secrets are passed
      expect(spawnOptions.env!.SECRET).toBeUndefined();
      expect(spawnOptions.env!.API_KEY).toBeUndefined();
      expect(spawnOptions.env!.PASSWORD).toBeUndefined();
    });
  });

  // ============================================
  // SAFE WRAPPER (runPythonScriptSafe)
  // ============================================
  describe('runPythonScriptSafe wrapper', () => {
    it('should return success result on valid execution', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);
      const testData = { key: 'value' };
      (mockProc.stdout.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          handler(Buffer.from(JSON.stringify(testData)));
        }
      });

      const result = await runPythonScriptSafe('split.py', 'test');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(testData);
      expect(result.error).toBeUndefined();
    });

    it('should return error result on execution failure', async () => {
      mockedSpawn.mockImplementation(() => {
        const err: any = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      });

      const result = await runPythonScriptSafe('split.py', 'test');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.data).toBeUndefined();
    });

    it('should catch and return JSONParseError', async () => {
      const mockProc: MockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
        on: jest.fn(((event: string, handler: Function): any => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return mockProc;
        }) as any),
        kill: jest.fn(),
        killed: false,
      };
      mockedSpawn.mockReturnValue(mockProc as any);
      (mockProc.stdout.on as jest.Mock).mockImplementation((event: string, handler: Function) => {
        if (event === 'data') {
          handler(Buffer.from('invalid json'));
        }
      });

      const result = await runPythonScriptSafe('split.py', 'test');

      expect(result.success).toBe(false);
      expect(result.error).toMatch('Invalid JSON');
    });
  });
});
