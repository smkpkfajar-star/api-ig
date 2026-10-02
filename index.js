import express from 'express';
import { ApifyClient } from 'apify-client';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const apify = new ApifyClient({ token: process.env.APIFY_TOKEN });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(express.json());

// ---------- Helper format ----------

// Ambil hashtag dari caption, lalu bersihkan caption dari hashtag
function splitCaption(caption = '') {
  const hashtags = (caption.match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.slice(1));
  const text = caption
    .replace(/#[\p{L}\p{N}_]+/gu, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, hashtags };
}

// Kumpulkan semua foto: carousel -> banyak, image -> satu, video -> kosong
function getImages(post) {
  if (post.type === 'Video') return [];
  if (post.type === 'Sidecar') {
    if (post.images?.length) return post.images;
    return (post.childPosts || []).map((c) => c.displayUrl).filter(Boolean);
  }
  return post.displayUrl ? [post.displayUrl] : [];
}

function formatInstagramPost(post, username) {
  const { text, hashtags } = splitCaption(post.caption);
  const isVideo = post.type === 'Video';

  return {
    id: post.id,
    username,
    short_code: post.shortCode,
    type: isVideo ? 'video' : post.type === 'Sidecar' ? 'carousel' : 'image',
    caption: text,
    hashtags,
    thumbnail_url: post.displayUrl || null,
    images: getImages(post), // selalu array
    is_video: isVideo,
    video_url: isVideo ? post.videoUrl || null : null,
    post_url: post.url,
    likes: post.likesCount || 0,
    posted_at: post.timestamp,
  };
}

// ---------- Simpan ke Supabase ----------

async function saveToSupabase(posts) {
  if (!posts.length) return 0;

  const rows = posts.map((p) => ({
    ...p,
    scraped_at: new Date().toISOString(),
  }));

  // id sudah ada -> diperbarui, belum ada -> ditambahkan
  const { error } = await supabase
    .from('berita')
    .upsert(rows, { onConflict: 'id' });

  if (error) throw new Error(`Supabase: ${error.message}`);
  return rows.length;
}

// ---------- Endpoint 1: scrape + simpan ----------
// GET /api/scrape/tamanindriajetis?limit=12

app.get('/api/scrape/:username', async (req, res) => {
  const { username } = req.params;
  const limit = Number(req.query.limit) || 12;

  try {
    const run = await apify.actor('apify/instagram-scraper').call({
      directUrls: [`https://www.instagram.com/${username}/`],
      resultsType: 'details',
      resultsLimit: 1,
    });

    const { items } = await apify.dataset(run.defaultDatasetId).listItems();
    const profile = items[0];

    if (!profile) {
      return res.status(404).json({ status: 'error', message: 'Akun tidak ditemukan.' });
    }

    const posts = (profile.latestPosts || [])
      // buang postingan kolaborasi milik akun lain
      .filter((p) => p.ownerUsername === username)
      .map((p) => formatInstagramPost(p, username))
      .sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at))
      .slice(0, limit);

    const saved = await saveToSupabase(posts);

    return res.status(200).json({
      status: 'success',
      account: {
        username: profile.username,
        name: profile.fullName,
        followers: profile.followersCount,
        posts_count: profile.postsCount,
      },
      saved,
      total: posts.length,
      data: posts,
    });
  } catch (error) {
    console.error('Error scrape:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal melakukan scraping / menyimpan data.',
      details: error.message,
    });
  }
});

// ---------- Endpoint 2: daftar berita dari Supabase ----------
// GET /api/berita?username=tamanindriajetis&limit=6

app.get('/api/berita', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 12, 50);
  const { username } = req.query;

  let query = supabase
    .from('berita')
    .select('*')
    .order('posted_at', { ascending: false })
    .limit(limit);

  if (username) query = query.eq('username', username);

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
  return res.json({ status: 'success', total: data.length, data });
});

// ---------- Endpoint 3: detail satu berita ----------
// GET /api/berita/Dcf9gMYE7EV

// Daftar berita berdasarkan username sekolah
// GET /api/berita/sekolah/tamanindriajetis?limit=6
app.get('/api/berita/sekolah/:username', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 12, 50);

  const { data, error } = await supabase
    .from('berita')
    .select('*')
    .eq('username', req.params.username)
    .order('posted_at', { ascending: false })
    .limit(limit);

  if (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
  if (!data.length) {
    return res.status(404).json({
      status: 'error',
      message: `Belum ada berita untuk username "${req.params.username}".`,
    });
  }
  return res.json({ status: 'success', total: data.length, data });
});

// GET /api/berita/detail/Dcf9gMYE7EV
app.get('/api/berita/detail/:shortCode', async (req, res) => {
  const { data, error } = await supabase
    .from('berita')
    .select('*')
    .eq('short_code', req.params.shortCode)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
  if (!data) {
    return res.status(404).json({ status: 'error', message: 'Berita tidak ditemukan.' });
  }
  return res.json({ status: 'success', data });
});

app.listen(PORT, () => {
  console.log(`Server Express berjalan di http://localhost:${PORT}`);
});