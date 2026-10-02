// utils/formatter.js
export function formatInstagramPost(rawPost) {
  const mediaUrls = (rawPost.images && rawPost.images.length > 0)
    ? rawPost.images
    : (rawPost.displayUrl ? [rawPost.displayUrl] : []);

  return {
    id: rawPost.id,
    shortCode: rawPost.shortCode,
    url: rawPost.url,
    caption: rawPost.caption || '',
    type: rawPost.type,
    likesCount: rawPost.likesCount || 0,
    commentsCount: rawPost.commentsCount || 0,
    timestamp: rawPost.timestamp,
    media: mediaUrls
  };
}