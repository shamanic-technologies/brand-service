import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUpload, mockGetPublicUrl, mockFrom } = vi.hoisted(() => {
  const mockUpload = vi.fn();
  const mockGetPublicUrl = vi.fn();
  const mockFrom = vi.fn(() => ({
    upload: mockUpload,
    getPublicUrl: mockGetPublicUrl,
    list: vi.fn(),
    remove: vi.fn(),
  }));
  return { mockUpload, mockGetPublicUrl, mockFrom };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: mockFrom,
    },
  })),
}));

describe('supabaseStorageService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.SUPABASE_URL = 'https://supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    process.env.SUPABASE_STORAGE_BUCKET = 'media-assets';
  });

  it('uploadBufferToSupabase writes a buffer and returns the public URL', async () => {
    mockUpload.mockResolvedValueOnce({ data: { path: 'persona-avatars/a.png' }, error: null });
    mockGetPublicUrl.mockReturnValueOnce({
      data: { publicUrl: 'https://storage.test/persona-avatars/a.png' },
    });

    const { uploadBufferToSupabase } = await import('../../src/services/supabaseStorageService');
    const result = await uploadBufferToSupabase(
      'persona-avatars/brand-1/persona-1/v1.png',
      Buffer.from('png-bytes'),
      'image/png',
    );

    expect(result).toEqual({
      url: 'https://storage.test/persona-avatars/a.png',
      path: 'persona-avatars/brand-1/persona-1/v1.png',
      bucket: 'media-assets',
    });
    expect(mockFrom).toHaveBeenCalledWith('media-assets');
    expect(mockUpload).toHaveBeenCalledWith(
      'persona-avatars/brand-1/persona-1/v1.png',
      Buffer.from('png-bytes'),
      { contentType: 'image/png', upsert: false },
    );
  });

  it('uploadBufferToSupabase rejects empty buffers before storage', async () => {
    const { uploadBufferToSupabase } = await import('../../src/services/supabaseStorageService');

    await expect(
      uploadBufferToSupabase('persona-avatars/empty.png', Buffer.alloc(0), 'image/png'),
    ).rejects.toThrow('Cannot upload empty buffer');
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
