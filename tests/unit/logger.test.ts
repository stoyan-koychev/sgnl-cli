import { logger } from '../../src/utils/logger';

describe('logger', () => {
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.setLevel('info'); // reset to default
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('should output info messages at info level', () => {
    logger.info('hello');
    expect(stderrSpy).toHaveBeenCalledWith('hello\n');
  });

  it('should output error messages at info level', () => {
    logger.error('bad');
    expect(stderrSpy).toHaveBeenCalledWith('bad\n');
  });

  it('should suppress debug messages at info level', () => {
    logger.debug('hidden');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('should show debug messages at debug level', () => {
    logger.setLevel('debug');
    logger.debug('visible');
    expect(stderrSpy).toHaveBeenCalledWith('visible\n');
  });

  it('should suppress info at warn level', () => {
    logger.setLevel('warn');
    logger.info('hidden');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('should show warn at warn level', () => {
    logger.setLevel('warn');
    logger.warn('warning');
    expect(stderrSpy).toHaveBeenCalledWith('warning\n');
  });

  it('should suppress everything at silent level', () => {
    logger.setLevel('silent');
    logger.error('nope');
    logger.warn('nope');
    logger.info('nope');
    logger.debug('nope');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('getLevel should return current level', () => {
    logger.setLevel('error');
    expect(logger.getLevel()).toBe('error');
  });
});
