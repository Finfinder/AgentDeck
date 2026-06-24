import { describe, it, expect } from 'vitest';
import { LOCAL_STORE_INDEX_VERSION, DEFAULT_EMBEDDING_DIMENSION, DEFAULT_EMBEDDING_MODEL, lexicalEmbedding, float32ToUint8 } from '@agentdeck/memory-service';

describe('LocalStore constants', () => {
  it('should have correct index version', () => {
    expect(LOCAL_STORE_INDEX_VERSION).toBe('phase9-v1');
  });

  it('should have correct default embedding dimension', () => {
    expect(DEFAULT_EMBEDDING_DIMENSION).toBe(8);
  });

  it('should have correct default embedding model', () => {
    expect(DEFAULT_EMBEDDING_MODEL).toBe('agentdeck-lexical-v1');
  });
});

describe('lexicalEmbedding', () => {
  it('should create a normalized vector', () => {
    const vec = lexicalEmbedding('hello world', 8);
    expect(vec.length).toBe(8);
    const norm = Math.sqrt(vec.reduce((s, v) => s + (v ?? 0) * (v ?? 0), 0));
    expect(Math.abs(norm - 1)).toBeLessThan(0.001);
  });

  it('should handle empty text', () => {
    const vec = lexicalEmbedding('', 8);
    expect(vec.length).toBe(8);
  });

  it('should produce consistent embeddings', () => {
    const v1 = lexicalEmbedding('test', 8);
    const v2 = lexicalEmbedding('test', 8);
    for (let i = 0; i < 8; i++) {
      expect(v1[i]).toBe(v2[i]);
    }
  });

  it('should use default dimension', () => {
    const vec = lexicalEmbedding('test');
    expect(vec.length).toBe(DEFAULT_EMBEDDING_DIMENSION);
  });

  it('should handle special characters', () => {
    const vec = lexicalEmbedding('hello! @world #test', 8);
    expect(vec.length).toBe(8);
  });

  it('should handle unicode text', () => {
    const vec = lexicalEmbedding('héllo wörld', 8);
    expect(vec.length).toBe(8);
  });

  it('should handle very long text', () => {
    const longText = 'word '.repeat(1000);
    const vec = lexicalEmbedding(longText, 8);
    expect(vec.length).toBe(8);
    const norm = Math.sqrt(vec.reduce((s, v) => s + (v ?? 0) * (v ?? 0), 0));
    expect(Math.abs(norm - 1)).toBeLessThan(0.001);
  });

  it('should produce different embeddings for different text', () => {
    const v1 = lexicalEmbedding('hello world foo bar', 8);
    const v2 = lexicalEmbedding('completely different tokens here', 8);
    const areEqual = v1.every((val, i) => val === v2[i]);
    expect(areEqual).toBe(false);
  });
});

describe('float32ToUint8', () => {
  it('should convert Float32Array to Uint8Array', () => {
    const input = new Float32Array([1, 2, 3]);
    const result = float32ToUint8(input);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(12);
  });

  it('should handle empty array', () => {
    const result = float32ToUint8(new Float32Array(0));
    expect(result.length).toBe(0);
  });

  it('should preserve data', () => {
    const input = new Float32Array([42.5, -1, 0]);
    const result = float32ToUint8(input);
    const view = new DataView(result.buffer);
    expect(view.getFloat32(0, true)).toBeCloseTo(42.5, 1);
    expect(view.getFloat32(4, true)).toBeCloseTo(-1, 1);
    expect(view.getFloat32(8, true)).toBe(0);
  });
});
