import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import './App.css';
import logo from './logo.svg';
import Login from './login';
import SignUp from './signup';
import { SUPABASE_ANON_KEY, SUPABASE_REST_URL } from './supabaseClient';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const defaultConversationStyle = {
  bubbleColor: '#e8f9ee',
  textColor: '#1f2430',
  fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif',
  fontSize: 16,
  isItalic: false,
  isBold: false,
  isUnderline: false,
  alignment: 'left',
};

function toBase64Url(bytes) {
  const binary = String.fromCharCode(...bytes);

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');

  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeSharePayload(payload) {
  return toBase64Url(encoder.encode(JSON.stringify(payload)));
}

function decodeSharePayload(value) {
  return JSON.parse(decoder.decode(fromBase64Url(value)));
}

async function supabaseRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${SUPABASE_REST_URL}${path}`, {
      ...options,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation,resolution=merge-duplicates',
        ...options.headers,
      },
    });
  } catch {
    throw new Error(`Network error. Check Supabase URL/key config. URL: ${SUPABASE_REST_URL}`);
  }

  if (!response.ok) {
    throw new Error('Supabase request failed');
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function makeShareId() {
  return `shr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function readShareStatusLocal(shareId) {
  if (!shareId) {
    return { received: false, viewed: false };
  }
  try {
    return JSON.parse(localStorage.getItem(`confession_status_${shareId}`)) || { received: false, viewed: false };
  } catch {
    return { received: false, viewed: false };
  }
}

function writeShareStatusLocal(shareId, nextStatus) {
  if (!shareId) {
    return;
  }
  localStorage.setItem(`confession_status_${shareId}`, JSON.stringify(nextStatus));
}

function readThreadLocal(shareId) {
  if (!shareId) {
    return [];
  }
  try {
    return JSON.parse(localStorage.getItem(`confession_thread_${shareId}`)) || [];
  } catch {
    return [];
  }
}

function writeThreadLocal(shareId, thread) {
  if (!shareId) {
    return;
  }
  localStorage.setItem(`confession_thread_${shareId}`, JSON.stringify(thread));
}

async function readShareStatus(shareId) {
  if (!shareId) {
    return { received: false, viewed: false };
  }

  try {
    const data = await supabaseRequest(`/share_status?share_id=eq.${shareId}&select=received,viewed&limit=1`);
    if (Array.isArray(data) && data[0]) {
      return {
        received: Boolean(data[0].received),
        viewed: Boolean(data[0].viewed),
      };
    }
  } catch {
    return readShareStatusLocal(shareId);
  }

  return readShareStatusLocal(shareId);
}

async function writeShareStatus(shareId, nextStatus) {
  if (!shareId) {
    return;
  }

  try {
    await supabaseRequest('/share_status', {
      method: 'POST',
      body: JSON.stringify([
        {
          share_id: shareId,
          received: Boolean(nextStatus.received),
          viewed: Boolean(nextStatus.viewed),
        },
      ]),
    });
  } catch {
    writeShareStatusLocal(shareId, nextStatus);
  }
}

async function readThread(shareId) {
  if (!shareId) {
    return [];
  }

  try {
    const data = await supabaseRequest(`/chat_messages?share_id=eq.${shareId}&select=role,text,created_at&order=created_at.asc`);
    if (Array.isArray(data)) {
      return data.map((row) => ({
        shareId,
        role: row.role,
        text: row.text,
        payload: parseChatPayload(row.text),
        at: new Date(row.created_at).getTime() || Date.now(),
      }));
    }
  } catch {
    return readThreadLocal(shareId);
  }

  return readThreadLocal(shareId);
}

async function appendThreadMessage(shareId, role, text) {
  if (!shareId) {
    return;
  }

  try {
    await supabaseRequest('/chat_messages', {
      method: 'POST',
      body: JSON.stringify([
        {
          share_id: shareId,
          role,
          text,
        },
      ]),
    });
  } catch {
    const current = readThreadLocal(shareId);
    writeThreadLocal(shareId, [...current, { role, text, at: Date.now() }]);
  }
}

async function readReceivedMessages() {
  try {
    const data = await supabaseRequest('/chat_messages?role=eq.receiver&select=share_id,role,text,created_at&order=created_at.desc');
    if (!Array.isArray(data)) {
      return [];
    }
    return data.map((row) => ({
      shareId: row.share_id,
      role: row.role,
      text: row.text,
      payload: parseChatPayload(row.text),
      at: new Date(row.created_at).getTime() || Date.now(),
    }));
  } catch {
    return [];
  }
}

async function submitFeedbackEntry(payload) {
  try {
    await supabaseRequest('/feedback', {
      method: 'POST',
      body: JSON.stringify([payload]),
    });
  } catch {
    const key = 'confession_feedback_local';
    const current = JSON.parse(localStorage.getItem(key) || '[]');
    current.push(payload);
    localStorage.setItem(key, JSON.stringify(current));
  }
}

function getFirstUrl(text) {
  if (!text) {
    return '';
  }
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : '';
}

function parseChatPayload(rawText) {
  const fallback = {
    text: rawText || '',
    spotifyUrl: '',
    media: null,
  };

  if (!rawText) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawText);
    if (parsed && parsed.kind === 'rich_chat_v1') {
      return {
        text: parsed.text || '',
        spotifyUrl: parsed.spotifyUrl || '',
        media: parsed.media || null,
      };
    }
  } catch {
    // Plain text legacy message.
  }

  return {
    ...fallback,
    spotifyUrl: getSpotifyEmbedUrl(rawText) ? getFirstUrl(rawText) : '',
  };
}

function getSpotifyEmbedUrl(url) {
  if (!url) {
    return '';
  }
  const match = url.match(/spotify\.com\/(track|album|playlist|episode)\/([a-zA-Z0-9]+)/);
  if (!match) {
    return '';
  }
  return `https://open.spotify.com/embed/${match[1]}/${match[2]}`;
}

function getYouTubeEmbedUrl(url) {
  if (!url) {
    return '';
  }
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
  const embedMatch = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{6,})/);
  const videoId = watchMatch?.[1] || shortMatch?.[1] || embedMatch?.[1] || '';
  if (!videoId) {
    return '';
  }
  return `https://www.youtube.com/embed/${videoId}`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

function makeAccessCode() {
  const values = new Uint32Array(1);
  window.crypto.getRandomValues(values);

  return String(100000 + (values[0] % 900000));
}

async function deriveShareKey(accessCode, salt) {
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(accessCode),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptShare(data, accessCode) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveShareKey(accessCode, salt);
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(data)),
  );

  return encodeSharePayload({
    v: 1,
    salt: toBase64Url(salt),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  });
}

async function decryptShare(payload, accessCode) {
  const salt = fromBase64Url(payload.salt);
  const iv = fromBase64Url(payload.iv);
  const key = await deriveShareKey(accessCode, salt);
  const plaintext = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    fromBase64Url(payload.ciphertext),
  );

  return JSON.parse(decoder.decode(plaintext));
}

function App() {
  const [sharedPayload, setSharedPayload] = useState(null);
  const [unlockCode, setUnlockCode] = useState('');
  const [unlockedShare, setUnlockedShare] = useState(null);
  const [unlockError, setUnlockError] = useState('');
  const [name, setName] = useState('you');
  const [detail, setDetail] = useState('the way you make ordinary days feel like a chorus');
  const [deliveryMode, setDeliveryMode] = useState('text');
  const [shareLink, setShareLink] = useState('');
  const [shareQr, setShareQr] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [senderIdentity, setSenderIdentity] = useState('');
  const [receiverPlan, setReceiverPlan] = useState('free');
  const [receiverProfile, setReceiverProfile] = useState({
    nickname: 'Anonymous Receiver',
    bio: '',
    theme: 'classic',
  });
  const [receiverProfileDraft, setReceiverProfileDraft] = useState({
    nickname: 'Anonymous Receiver',
    bio: '',
    theme: 'classic',
  });
  const [profileStatus, setProfileStatus] = useState('');
  const [recordedVoice, setRecordedVoice] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [musicMedia, setMusicMedia] = useState(null);
  const [photoMedia, setPhotoMedia] = useState(null);
  const [videoMedia, setVideoMedia] = useState(null);
  const [mediaStatus, setMediaStatus] = useState('');
  const mediaRecorderRef = useRef(null);
  const mediaChunksRef = useRef([]);
  const [senderChatPremium, setSenderChatPremium] = useState(false);
  const [currentShareId, setCurrentShareId] = useState('');
  const [senderStatus, setSenderStatus] = useState({ received: false, viewed: false });
  const [threadMessages, setThreadMessages] = useState([]);
  const [senderChatText, setSenderChatText] = useState('');
  const [receiverChatText, setReceiverChatText] = useState('');
  const [chatStatus, setChatStatus] = useState('');
  const [conversationStyle, setConversationStyle] = useState(defaultConversationStyle);
  const [isEditingDetail, setIsEditingDetail] = useState(true);
  const [draftStatus, setDraftStatus] = useState('');
  const [spotifyUrl, setSpotifyUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [mediaLinkStatus, setMediaLinkStatus] = useState('');
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackEmail, setFeedbackEmail] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [activeTab, setActiveTab] = useState('compose');
  const [receivedMessages, setReceivedMessages] = useState([]);
  const [selectedInboxShareId, setSelectedInboxShareId] = useState('');
  const [receiverReplySpotifyUrl, setReceiverReplySpotifyUrl] = useState('');
  const [receiverReplyVoice, setReceiverReplyVoice] = useState('');
  const [receiverReplyPhoto, setReceiverReplyPhoto] = useState(null);
  const [receiverReplyVideo, setReceiverReplyVideo] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authPrefillUsername, setAuthPrefillUsername] = useState('');
  const [authNotice, setAuthNotice] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('confession_current_user');
      if (saved) {
        setCurrentUser(JSON.parse(saved));
      }
    } catch {
      setCurrentUser(null);
    }
  }, []);

  useEffect(() => {
    const hash = window.location.hash;

    if (!hash.startsWith('#confession=')) {
      return;
    }

    try {
      const decoded = decodeSharePayload(hash.replace('#confession=', ''));
      setSharedPayload(decoded);
      const shareId = decoded.shareId;
      if (shareId) {
        readShareStatus(shareId).then((existingStatus) => {
          const nextStatus = { ...existingStatus, received: true };
          writeShareStatus(shareId, nextStatus);
        });
      }
    } catch {
      setUnlockError('This confession link is damaged or incomplete.');
    }
  }, []);

  useEffect(() => {
    if (!currentShareId) {
      return undefined;
    }
    const sync = async () => {
      setSenderStatus(await readShareStatus(currentShareId));
      setThreadMessages(await readThread(currentShareId));
    };
    void sync();
    const timer = window.setInterval(sync, 1200);
    return () => window.clearInterval(timer);
  }, [currentShareId]);

  useEffect(() => {
    if (!unlockedShare?.shareId) {
      return undefined;
    }
    const sync = async () => {
      setThreadMessages(await readThread(unlockedShare.shareId));
    };
    void sync();
    const timer = window.setInterval(sync, 1200);
    return () => window.clearInterval(timer);
  }, [unlockedShare]);

  useEffect(() => {
    const sync = async () => {
      setReceivedMessages(await readReceivedMessages());
    };
    void sync();
    const timer = window.setInterval(sync, 1600);
    return () => window.clearInterval(timer);
  }, []);

  const confession = useMemo(() => {
    return `I want to tell you something clearly: ${detail}. ${name}, I like you, and I want to know what this could become.`;
  }, [detail, name]);

  const smsLink = `sms:?&body=${encodeURIComponent(confession)}`;

  const speakConfession = () => {
    if (!('speechSynthesis' in window)) {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(confession);
    utterance.rate = 0.92;
    utterance.pitch = 1.05;
    window.speechSynthesis.speak(utterance);
  };

  const stopVoice = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const createPrivateShare = async () => {
    setShareStatus('Creating private link...');
    const nextAccessCode = makeAccessCode();
    const encryptedPayload = await encryptShare(
      {
        shareId: makeShareId(),
        confession,
        title: 'A private confession',
        recipient: name,
        senderIdentity: senderIdentity.trim(),
        receiverPlan,
        receiverProfile,
        senderChatPremium,
        conversationStyle,
        media: {
          recordedVoice,
          music: musicMedia,
          photo: photoMedia,
          video: videoMedia,
          spotifyUrl,
          youtubeUrl,
        },
      },
      nextAccessCode,
    );
    const nextShareLink = `${window.location.origin}${window.location.pathname}#confession=${encryptedPayload}`;
    const nextQr = await QRCode.toDataURL(nextShareLink, {
      margin: 1,
      scale: 7,
      color: {
        dark: '#201719',
        light: '#fffaf4',
      },
    });

    setAccessCode(nextAccessCode);
    const decodedPayload = decodeSharePayload(encryptedPayload);
    setCurrentShareId(decodedPayload.shareId || '');
    readShareStatus(decodedPayload.shareId).then(setSenderStatus);
    readThread(decodedPayload.shareId).then(setThreadMessages);
    setShareLink(nextShareLink);
    setShareQr(nextQr);
    setShareStatus('Private link ready.');
  };

  const unlockShare = async (event) => {
    event.preventDefault();
    setUnlockError('');

    try {
      const nextUnlockedShare = await decryptShare(sharedPayload, unlockCode.trim());
      setUnlockedShare(nextUnlockedShare);
      setConversationStyle(nextUnlockedShare.conversationStyle || defaultConversationStyle);
      setSpotifyUrl(nextUnlockedShare?.media?.spotifyUrl || '');
      setYoutubeUrl(nextUnlockedShare?.media?.youtubeUrl || '');
      const current = await readShareStatus(nextUnlockedShare.shareId);
      await writeShareStatus(nextUnlockedShare.shareId, { ...current, received: true, viewed: true });
    } catch {
      setUnlockError('That access code did not unlock this confession.');
    }
  };

  const saveReceiverProfile = () => {
    setReceiverProfile(receiverProfileDraft);
    setProfileStatus('Receiver profile updated.');
  };

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          mediaChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(mediaChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const audioFile = new File([blob], 'voice-message.webm', { type: blob.type });
        const dataUrl = await fileToDataUrl(audioFile);
        setRecordedVoice(dataUrl);
        stream.getTracks().forEach((track) => track.stop());
        setMediaStatus('Voice message recorded.');
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setMediaStatus('Recording voice message...');
    } catch {
      setMediaStatus('Microphone access failed.');
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleMediaUpload = async (event, setMedia, label) => {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setMedia({
        name: file.name,
        type: file.type,
        dataUrl,
      });
      setMediaStatus(`${label} added.`);
    } catch {
      setMediaStatus(`Failed to add ${label.toLowerCase()}.`);
    }
  };

  const postChatMessage = async (shareId, role, text, unlimited, extras = {}) => {
    const trimmed = text.trim();
    const hasMedia = Boolean(extras.media?.voice?.dataUrl || extras.media?.photo?.dataUrl || extras.media?.video?.dataUrl);
    const hasSpotify = Boolean(extras.spotifyUrl);
    if (!trimmed && !hasMedia && !hasSpotify) {
      return { ok: false, reason: 'empty' };
    }
    const current = await readThread(shareId);
    if (!unlimited && current.length >= 10) {
      return { ok: false, reason: 'limit' };
    }
    const payload = JSON.stringify({
      kind: 'rich_chat_v1',
      text: trimmed,
      spotifyUrl: extras.spotifyUrl || '',
      media: extras.media || null,
    });
    await appendThreadMessage(shareId, role, payload);
    setThreadMessages(await readThread(shareId));
    return { ok: true };
  };

  const renderChatMessage = (message, index) => {
    const payload = message.payload || parseChatPayload(message.text);
    const spotifyEmbed = getSpotifyEmbedUrl(payload.spotifyUrl);
    return (
      <div className="chat-message" key={`${message.at}-${index}`}>
        <p>
          <img alt="Message icon" src={logo} width="14" height="14" style={{ verticalAlign: 'middle', marginRight: 6 }} />
          <strong>{message.role === 'sender' ? 'Sender' : 'Receiver'}:</strong> {payload.text || '(media message)'}
        </p>
        {message.shareId ? <p className="privacy-note">Share ID: {message.shareId}</p> : null}
        {spotifyEmbed ? (
          <div>
            <a className="secondary" href={payload.spotifyUrl} target="_blank" rel="noreferrer">Play on Spotify</a>
            <iframe
              title={`spotify-${message.at}-${index}`}
              src={spotifyEmbed}
              width="100%"
              height="152"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            />
          </div>
        ) : null}
        {payload.media?.voice?.dataUrl ? <audio controls src={payload.media.voice.dataUrl} /> : null}
        {payload.media?.photo?.dataUrl ? <img alt={payload.media.photo.name || 'Shared photo'} src={payload.media.photo.dataUrl} /> : null}
        {payload.media?.video?.dataUrl ? <video controls src={payload.media.video.dataUrl} /> : null}
      </div>
    );
  };

  const chatInlineStyle = {
    '--bubble-color': conversationStyle.bubbleColor,
    '--chat-text-color': conversationStyle.textColor,
    fontFamily: conversationStyle.fontFamily,
    fontSize: `${conversationStyle.fontSize}px`,
    fontStyle: conversationStyle.isItalic ? 'italic' : 'normal',
    fontWeight: conversationStyle.isBold ? 700 : 500,
    textDecoration: conversationStyle.isUnderline ? 'underline' : 'none',
    textAlign: conversationStyle.alignment,
  };

  const writingInlineStyle = {
    fontFamily: conversationStyle.fontFamily,
    fontSize: `${conversationStyle.fontSize}px`,
    fontStyle: conversationStyle.isItalic ? 'italic' : 'normal',
    fontWeight: conversationStyle.isBold ? 700 : 500,
    textDecoration: conversationStyle.isUnderline ? 'underline' : 'none',
    textAlign: conversationStyle.alignment,
    color: conversationStyle.textColor,
    backgroundColor: conversationStyle.bubbleColor,
  };

  const saveTextDraft = () => {
    localStorage.setItem('confession_text_draft', detail);
    supabaseRequest('/drafts', {
      method: 'POST',
      body: JSON.stringify([{ draft_key: 'confession_text_draft', content: detail }]),
    }).catch(() => {});
    setDraftStatus('Draft saved.');
  };

  const saveMediaLinks = () => {
    const payload = {
      spotifyUrl: spotifyUrl.trim(),
      youtubeUrl: youtubeUrl.trim(),
    };
    localStorage.setItem(
      'confession_media_links',
      JSON.stringify(payload),
    );
    supabaseRequest('/drafts', {
      method: 'POST',
      body: JSON.stringify([{ draft_key: 'confession_media_links', content: JSON.stringify(payload) }]),
    }).catch(() => {});
    setMediaLinkStatus('Media links saved.');
  };

  const submitFeedback = async (event) => {
    event.preventDefault();
    const message = feedbackText.trim();
    if (!message) {
      setFeedbackStatus('Please write your feedback first.');
      return;
    }

    await submitFeedbackEntry({
      message,
      email: feedbackEmail.trim() || null,
      created_at: new Date().toISOString(),
      page: window.location.pathname,
    });
    setFeedbackText('');
    setFeedbackEmail('');
    setFeedbackStatus('Thanks. Feedback submitted.');
  };

  const handleLogout = () => {
    localStorage.removeItem('confession_current_user');
    setCurrentUser(null);
    setAuthMode('login');
    setAuthNotice('You have been logged out.');
    setAuthPrefillUsername('');
  };

  if (!currentUser) {
    return (
      <main className="app-shell" style={{ '--accent': '#d66bff' }}>
        <section className="workspace" aria-label="Authentication">
          <div className="composer">
            <div className="section-heading">
              <p>Welcome</p>
              <h2>{authMode === 'login' ? 'Log in with username' : 'Sign up with username'}</h2>
            </div>
            {authMode === 'login' ? (
              <Login
                initialUsername={authPrefillUsername}
                onSuccess={(user) => {
                  setCurrentUser(user);
                  localStorage.setItem('confession_current_user', JSON.stringify(user));
                }}
              />
            ) : (
              <SignUp
                onSuccess={(user) => {
                  setAuthPrefillUsername(user.email || '');
                  setAuthMode('login');
                  setAuthNotice('Sign up successful. Log in with your username and password.');
                }}
              />
            )}
            {authNotice ? <p className="privacy-note">{authNotice}</p> : null}
            <div className="actions compact">
              <button
                className={authMode === 'login' ? 'secondary' : ''}
                type="button"
                onClick={() => {
                  setAuthMode('login');
                  setAuthNotice('');
                }}
              >
                Log in
              </button>
              <button
                className={authMode === 'signup' ? 'secondary' : ''}
                type="button"
                onClick={() => {
                  setAuthMode('signup');
                  setAuthNotice('');
                }}
              >
                Sign up
              </button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (sharedPayload) {
    const canRevealSender = receiverPlan === 'premium';
    const senderLabel = unlockedShare?.senderIdentity?.trim()
      ? unlockedShare.senderIdentity
      : 'Anonymous sender';

    return (
      <main className="app-shell shared-shell">
        <section className="unlock-panel" aria-labelledby="unlock-title">
          <p className="eyebrow">Private confession</p>
          {unlockedShare ? (
            <>
              <h1 id="unlock-title">{unlockedShare.title}</h1>
              <div className="receiver-badge">
                <p className="eyebrow">Receiver Profile</p>
                <p>
                  <strong>{unlockedShare?.receiverProfile?.nickname || 'Anonymous Receiver'}</strong>
                </p>
                <p>{unlockedShare?.receiverProfile?.bio || 'No bio provided.'}</p>
              </div>
              <blockquote>{unlockedShare.confession}</blockquote>
              {unlockedShare?.media?.recordedVoice ? (
                <audio controls src={unlockedShare.media.recordedVoice} />
              ) : null}
              {unlockedShare?.media?.music?.dataUrl ? (
                <audio controls src={unlockedShare.media.music.dataUrl} />
              ) : null}
              {unlockedShare?.media?.photo?.dataUrl ? (
                <img
                  alt={unlockedShare.media.photo.name || 'Shared photo'}
                  src={unlockedShare.media.photo.dataUrl}
                />
              ) : null}
              {unlockedShare?.media?.video?.dataUrl ? (
                <video controls src={unlockedShare.media.video.dataUrl} />
              ) : null}
              {unlockedShare?.media?.spotifyUrl ? (
                <iframe
                  title="Spotify player"
                  src={getSpotifyEmbedUrl(unlockedShare.media.spotifyUrl)}
                  width="100%"
                  height="152"
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                />
              ) : null}
              {unlockedShare?.media?.youtubeUrl ? (
                <iframe
                  title="YouTube player"
                  src={getYouTubeEmbedUrl(unlockedShare.media.youtubeUrl)}
                  width="100%"
                  height="240"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : null}
              <dl className="stats">
                <div>
                  <dt>For</dt>
                  <dd>{unlockedShare.recipient}</dd>
                </div>
                <div>
                  <dt>Privacy</dt>
                  <dd>Anonymous by default</dd>
                </div>
              </dl>
              <div className="sender-reveal">
                <h3>Sender</h3>
                <p>
                  {canRevealSender ? senderLabel : 'Anonymous sender (hidden)'}
                </p>
                {!canRevealSender ? (
                  <p className="privacy-note">
                    Reveal is locked. Subscribe to receiver premium to reveal the sender.
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <h1 id="unlock-title">Enter the access code.</h1>
              <p className="hero-text">
                This message is encrypted in the link and only opens with the
                code shared by the sender.
              </p>
              <form className="unlock-form" onSubmit={unlockShare}>
                <label className="field">
                  <span>Access code</span>
                  <input
                    inputMode="numeric"
                    onChange={(event) => setUnlockCode(event.target.value)}
                    placeholder="6-digit code"
                    value={unlockCode}
                  />
                </label>
                <button type="submit">Unlock message</button>
              </form>
              {unlockError ? <p className="error-text">{unlockError}</p> : null}
            </>
          )}
          {unlockedShare ? (
            <div className="private-share">
              <div>
                <h3>Respond to sender</h3>
                <p>Reply to open chat. Sender can chat only after your response.</p>
              </div>
              <label className="field">
                <span>Your response</span>
                <textarea
                  rows="3"
                  value={receiverChatText}
                  onChange={(event) => setReceiverChatText(event.target.value)}
                  placeholder="Type your response"
                />
              </label>
              <label className="field">
                <span>Spotify link (optional)</span>
                <input
                  type="url"
                  value={receiverReplySpotifyUrl}
                  onChange={(event) => setReceiverReplySpotifyUrl(event.target.value)}
                  placeholder="https://open.spotify.com/track/..."
                />
              </label>
              <label className="field">
                <span>Attach voice (optional)</span>
                <input
                  accept="audio/*"
                  type="file"
                  onChange={async (event) => {
                    const [file] = event.target.files || [];
                    if (!file) {
                      return;
                    }
                    const dataUrl = await fileToDataUrl(file);
                    setReceiverReplyVoice(dataUrl);
                  }}
                />
              </label>
              <label className="field">
                <span>Attach photo (optional)</span>
                <input
                  accept="image/*"
                  type="file"
                  onChange={(event) => handleMediaUpload(event, setReceiverReplyPhoto, 'Reply photo')}
                />
              </label>
              <label className="field">
                <span>Attach video (optional)</span>
                <input
                  accept="video/*"
                  type="file"
                  onChange={(event) => handleMediaUpload(event, setReceiverReplyVideo, 'Reply video')}
                />
              </label>
              <button
                type="button"
                onClick={async () => {
                  const unlimited = Boolean(unlockedShare.senderChatPremium);
                  const result = await postChatMessage(unlockedShare.shareId, 'receiver', receiverChatText, unlimited, {
                    spotifyUrl: receiverReplySpotifyUrl.trim(),
                    media: {
                      voice: receiverReplyVoice ? { dataUrl: receiverReplyVoice, name: 'voice-message' } : null,
                      photo: receiverReplyPhoto,
                      video: receiverReplyVideo,
                    },
                  });
                  if (result.ok) {
                    setReceiverChatText('');
                    setReceiverReplySpotifyUrl('');
                    setReceiverReplyVoice('');
                    setReceiverReplyPhoto(null);
                    setReceiverReplyVideo(null);
                    setChatStatus('Response sent.');
                    const statusNow = await readShareStatus(unlockedShare.shareId);
                    await writeShareStatus(unlockedShare.shareId, { ...statusNow, viewed: true });
                  } else if (result.reason === 'limit') {
                    setChatStatus('Free chat limit reached (10 messages).');
                  }
                }}
              >
                Send response
              </button>
              <p className="privacy-note">{chatStatus}</p>
              <div className="field">
                <span>Chat thread</span>
                <div className="private-share chat-thread" style={chatInlineStyle}>
                  {threadMessages.length === 0 ? (
                    <p className="privacy-note">No messages yet.</p>
                  ) : (
                    threadMessages.map(renderChatMessage)
                  )}
                </div>
              </div>
            </div>
          ) : null}
          {unlockedShare ? (
            <div className="private-share">
              <div>
                <h3>Conversation Customization</h3>
                <p>Adjust colors in one section and typography/style in another section.</p>
              </div>
              <h4>Colors</h4>
              <div className="style-grid">
                <label className="field">
                  <span>Bubble color</span>
                  <input
                    type="color"
                    value={conversationStyle.bubbleColor}
                    onChange={(event) =>
                      setConversationStyle((current) => ({ ...current, bubbleColor: event.target.value }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Text color</span>
                  <input
                    type="color"
                    value={conversationStyle.textColor}
                    onChange={(event) =>
                      setConversationStyle((current) => ({ ...current, textColor: event.target.value }))
                    }
                  />
                </label>
              </div>
              <h4>Typography & Style</h4>
              <div className="style-grid">
                <label className="field">
                  <span>Font style</span>
                  <select
                    value={conversationStyle.fontFamily}
                    onChange={(event) =>
                      setConversationStyle((current) => ({ ...current, fontFamily: event.target.value }))
                    }
                  >
                    <option value={'"Trebuchet MS", "Segoe UI", sans-serif'}>Trebuchet</option>
                    <option value={'Georgia, "Times New Roman", serif'}>Georgia</option>
                    <option value={'"Courier New", monospace'}>Courier New</option>
                    <option value={'"Lucida Handwriting", cursive'}>Lucida Handwriting</option>
                  </select>
                </label>
                <label className="field">
                  <span>Size ({conversationStyle.fontSize}px)</span>
                  <input
                    type="range"
                    min="12"
                    max="24"
                    value={conversationStyle.fontSize}
                    onChange={(event) =>
                      setConversationStyle((current) => ({
                        ...current,
                        fontSize: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Alignment</span>
                  <select
                    value={conversationStyle.alignment}
                    onChange={(event) =>
                      setConversationStyle((current) => ({ ...current, alignment: event.target.value }))
                    }
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </label>
                <label className="field">
                  <span>Text style</span>
                  <div className="style-toggles">
                    <label>
                      <input
                        type="checkbox"
                        checked={conversationStyle.isItalic}
                        onChange={(event) =>
                          setConversationStyle((current) => ({ ...current, isItalic: event.target.checked }))
                        }
                      />
                      Italic
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={conversationStyle.isBold}
                        onChange={(event) =>
                          setConversationStyle((current) => ({ ...current, isBold: event.target.checked }))
                        }
                      />
                      Bold
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={conversationStyle.isUnderline}
                        onChange={(event) =>
                          setConversationStyle((current) => ({ ...current, isUnderline: event.target.checked }))
                        }
                      />
                      Underline
                    </label>
                  </div>
                </label>
              </div>
            </div>
          ) : null}
          <div className="receiver-subscribe">
            <h3>Receiver Premium (PHP 50)</h3>
            <p>
              Subscribe to reveal anonymous sender identity when available.
            </p>
            <div className="actions compact">
              <button
                className={receiverPlan === 'free' ? 'secondary' : ''}
                onClick={() => setReceiverPlan('free')}
                type="button"
              >
                Free plan
              </button>
              <button
                onClick={() => setReceiverPlan('premium')}
                type="button"
              >
                Subscribe Premium
              </button>
            </div>
            <p className="privacy-note">
              Current receiver plan: {receiverPlan === 'premium' ? 'Premium' : 'Free'}
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell" style={{ '--accent': '#d66bff' }}>
      <section className="hero" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow">MAMAMOO inspired confession maker</p>
          <h1 id="page-title">Make the feeling sound ready for the spotlight.</h1>
          <p className="hero-text">
            Draft a short confession with a mood, a detail that only feels like
            yours, and a final line confident enough to send.
          </p>
        </div>

        <div className="stage-visual" aria-hidden="true">
          <div className="spotlight spotlight-one" />
          <div className="spotlight spotlight-two" />
          <div className="vinyl">
            <span />
          </div>
          <div className="lyric-strip">CONFESSION / STAGE / HEART</div>
        </div>
      </section>

      <section className="workspace" aria-label="Confession builder">
        <div className="composer">
          <div className="section-heading">
            <p>Compose</p>
            <h2>Shape the message</h2>
          </div>
          <div className="private-share">
            <div>
              <h3>Account</h3>
              <p>Signed in as <strong>{currentUser?.email || 'unknown user'}</strong></p>
            </div>
            <div className="actions compact">
              <button className="secondary" type="button" onClick={handleLogout}>
                Log out
              </button>
            </div>
          </div>
          <div className="actions compact">
            <button className={activeTab === 'compose' ? '' : 'secondary'} type="button" onClick={() => setActiveTab('compose')}>
              Compose
            </button>
            <button className={activeTab === 'inbox' ? '' : 'secondary'} type="button" onClick={() => setActiveTab('inbox')}>
              Inbox
            </button>
          </div>
          {activeTab === 'inbox' ? (
            <div className="private-share">
              <div>
                <h3>Received Messages Compilation</h3>
                <p>All receiver messages across shares, with media and Spotify playback.</p>
              </div>
              {receivedMessages.length === 0 ? (
                <p className="privacy-note">No received messages yet.</p>
              ) : (
                receivedMessages.map((message, index) => (
                  <div key={`inbox-${message.at}-${index}`}>
                    {renderChatMessage(message, index)}
                    {message.shareId ? (
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => {
                          setSelectedInboxShareId(message.shareId);
                          setChatStatus(`Replying to ${message.shareId}`);
                        }}
                      >
                        Reply to this message
                      </button>
                    ) : null}
                  </div>
                ))
              )}
              <p className="privacy-note">
                {selectedInboxShareId ? `Selected thread: ${selectedInboxShareId}` : 'Select a message to reply.'}
              </p>
              <label className="field">
                <span>Reply text</span>
                <textarea rows="2" value={senderChatText} onChange={(event) => setSenderChatText(event.target.value)} />
              </label>
              <button
                className="secondary"
                type="button"
                onClick={async () => {
                  const targetShareId = selectedInboxShareId.trim();
                  if (!targetShareId) {
                    setChatStatus('Select a message to reply.');
                    return;
                  }
                  const result = await postChatMessage(targetShareId, 'sender', senderChatText, senderChatPremium);
                  if (result.ok) {
                    setSenderChatText('');
                    setChatStatus('Reply sent.');
                    setReceivedMessages(await readReceivedMessages());
                  } else if (result.reason === 'limit') {
                    setChatStatus('Free chat limit reached (10 messages).');
                  }
                }}
              >
                Send reply
              </button>
              <p className="privacy-note">{chatStatus}</p>
            </div>
          ) : null}
          <label className="field">
            <span>To</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="their name"
            />
          </label>

          <label className="field">
            <span>Sender identity (optional)</span>
            <input
              value={senderIdentity}
              onChange={(event) => setSenderIdentity(event.target.value)}
              placeholder="your name or alias"
            />
          </label>

          <div className="private-share">
            <div>
              <h3>Sender Premium Chat (PHP 50)</h3>
              <p>Free chat allows 10 total messages. Premium unlocks unlimited chat.</p>
            </div>
            <div className="actions compact">
              <button
                className={senderChatPremium ? '' : 'secondary'}
                type="button"
                onClick={() => setSenderChatPremium(true)}
              >
                Avail premium
              </button>
              <button
                className={!senderChatPremium ? '' : 'secondary'}
                type="button"
                onClick={() => setSenderChatPremium(false)}
              >
                Keep free
              </button>
            </div>
            <p className="privacy-note">Current chat plan: {senderChatPremium ? 'Premium' : 'Free (10 messages)'}</p>
          </div>
          <div className="private-share">
            <div>
              <h3>Conversation Customization Features</h3>
              <p>Personalize your chat with separate color and typography/style sections.</p>
            </div>
            <h4>Colors</h4>
            <div className="style-grid">
              <label className="field">
                <span>Bubble color</span>
                <input
                  type="color"
                  value={conversationStyle.bubbleColor}
                  onChange={(event) =>
                    setConversationStyle((current) => ({ ...current, bubbleColor: event.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>Text color</span>
                <input
                  type="color"
                  value={conversationStyle.textColor}
                  onChange={(event) =>
                    setConversationStyle((current) => ({ ...current, textColor: event.target.value }))
                  }
                />
              </label>
            </div>
            <h4>Typography & Style</h4>
            <div className="style-grid">
              <label className="field">
                <span>Font style</span>
                <select
                  value={conversationStyle.fontFamily}
                  onChange={(event) =>
                    setConversationStyle((current) => ({ ...current, fontFamily: event.target.value }))
                  }
                >
                  <option value={'"Trebuchet MS", "Segoe UI", sans-serif'}>Trebuchet</option>
                  <option value={'Georgia, "Times New Roman", serif'}>Georgia</option>
                  <option value={'"Courier New", monospace'}>Courier New</option>
                  <option value={'"Lucida Handwriting", cursive'}>Lucida Handwriting</option>
                </select>
              </label>
              <label className="field">
                <span>Size ({conversationStyle.fontSize}px)</span>
                <input
                  type="range"
                  min="12"
                  max="24"
                  value={conversationStyle.fontSize}
                  onChange={(event) =>
                    setConversationStyle((current) => ({
                      ...current,
                      fontSize: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Alignment</span>
                <select
                  value={conversationStyle.alignment}
                  onChange={(event) =>
                    setConversationStyle((current) => ({ ...current, alignment: event.target.value }))
                  }
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </label>
              <label className="field">
                <span>Text style</span>
                <div className="style-toggles">
                  <label>
                    <input
                      type="checkbox"
                      checked={conversationStyle.isItalic}
                      onChange={(event) =>
                        setConversationStyle((current) => ({ ...current, isItalic: event.target.checked }))
                      }
                    />
                    Italic
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={conversationStyle.isBold}
                      onChange={(event) =>
                        setConversationStyle((current) => ({ ...current, isBold: event.target.checked }))
                      }
                    />
                    Bold
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={conversationStyle.isUnderline}
                      onChange={(event) =>
                        setConversationStyle((current) => ({ ...current, isUnderline: event.target.checked }))
                      }
                    />
                    Underline
                  </label>
                </div>
              </label>
            </div>
          </div>

          <label className="field">
            <span>Share what you feel</span>
            <textarea
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              rows="4"
              placeholder="a memory, habit, song, or moment"
              style={writingInlineStyle}
              disabled={!isEditingDetail}
            />
          </label>
          <div className="actions compact">
            <button
              className="secondary"
              type="button"
              onClick={() => setIsEditingDetail((current) => !current)}
            >
              {isEditingDetail ? 'Done editing' : 'Edit text'}
            </button>
            <button className="secondary" type="button" onClick={saveTextDraft}>
              Save draft
            </button>
          </div>
          <p className="privacy-note">
            {draftStatus || (detail.trim() ? 'Text written. Click "Edit text" anytime to update it.' : 'No draft action yet.')}
          </p>

          <div className="private-share">
            <div>
              <h3>Voice and Media</h3>
              <p>
                Record a voice message and attach music, photos, and videos.
              </p>
            </div>
            <div className="actions compact">
              <button onClick={startVoiceRecording} type="button" disabled={isRecording}>
                Record voice
              </button>
              <button
                className="secondary"
                onClick={stopVoiceRecording}
                type="button"
                disabled={!isRecording}
              >
                Stop recording
              </button>
            </div>
            {recordedVoice ? (
              <div className="field">
                <span>Voice preview</span>
                <audio controls src={recordedVoice} />
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setRecordedVoice('');
                    setMediaStatus('Voice message removed.');
                  }}
                >
                  Remove voice
                </button>
              </div>
            ) : null}
            <label className="field">
              <span>Add music</span>
              <input
                accept="audio/*"
                type="file"
                onChange={(event) => handleMediaUpload(event, setMusicMedia, 'Music')}
              />
            </label>
            <label className="field">
              <span>Add photo</span>
              <input
                accept="image/*"
                type="file"
                onChange={(event) => handleMediaUpload(event, setPhotoMedia, 'Photo')}
              />
            </label>
            <label className="field">
              <span>Add video</span>
              <input
                accept="video/*"
                type="file"
                onChange={(event) => handleMediaUpload(event, setVideoMedia, 'Video')}
              />
            </label>
            {(musicMedia?.dataUrl || photoMedia?.dataUrl || videoMedia?.dataUrl) ? (
              <div className="field">
                <span>Sender media preview</span>
                {musicMedia?.dataUrl ? (
                  <div>
                    <p className="privacy-note">Music: {musicMedia.name || 'Uploaded audio'}</p>
                    <audio controls src={musicMedia.dataUrl} />
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => {
                        setMusicMedia(null);
                        setMediaStatus('Music removed.');
                      }}
                    >
                      Remove music
                    </button>
                  </div>
                ) : null}
                {photoMedia?.dataUrl ? (
                  <div>
                    <p className="privacy-note">Photo: {photoMedia.name || 'Uploaded image'}</p>
                    <img alt={photoMedia.name || 'Uploaded photo preview'} src={photoMedia.dataUrl} />
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => {
                        setPhotoMedia(null);
                        setMediaStatus('Photo removed.');
                      }}
                    >
                      Remove photo
                    </button>
                  </div>
                ) : null}
                {videoMedia?.dataUrl ? (
                  <div>
                    <p className="privacy-note">Video: {videoMedia.name || 'Uploaded video'}</p>
                    <video controls src={videoMedia.dataUrl} />
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => {
                        setVideoMedia(null);
                        setMediaStatus('Video removed.');
                      }}
                    >
                      Remove video
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <label className="field">
              <span>Spotify link (music)</span>
              <input
                type="url"
                value={spotifyUrl}
                onChange={(event) => setSpotifyUrl(event.target.value)}
                placeholder="https://open.spotify.com/track/..."
                aria-describedby="spotify-help"
              />
              <small id="spotify-help">Paste a Spotify track, album, playlist, or episode URL.</small>
            </label>
            <label className="field">
              <span>YouTube link (video)</span>
              <input
                type="url"
                value={youtubeUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                aria-describedby="youtube-help"
              />
              <small id="youtube-help">Paste a YouTube watch, short, or embed URL.</small>
            </label>
            <button className="secondary" type="button" onClick={saveMediaLinks}>
              Save media links
            </button>
            <p className="privacy-note" role="status" aria-live="polite">
              {mediaLinkStatus}
            </p>
            <p className="privacy-note">{mediaStatus || 'No media added yet.'}</p>
          </div>
        </div>

        <aside className="preview" aria-label="Generated confession">
          <div className="section-heading">
            <p>Preview</p>
            <h2>A private confession</h2>
          </div>
          <blockquote>{confession}</blockquote>
          {recordedVoice ? <audio controls src={recordedVoice} /> : null}
          {musicMedia?.dataUrl ? <audio controls src={musicMedia.dataUrl} /> : null}
          {photoMedia?.dataUrl ? <img alt={photoMedia.name || 'Uploaded photo'} src={photoMedia.dataUrl} /> : null}
          {videoMedia?.dataUrl ? <video controls src={videoMedia.dataUrl} /> : null}
          {spotifyUrl && getSpotifyEmbedUrl(spotifyUrl) ? (
            <iframe
              title="Spotify player preview"
              src={getSpotifyEmbedUrl(spotifyUrl)}
              width="100%"
              height="152"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            />
          ) : null}
          {youtubeUrl && getYouTubeEmbedUrl(youtubeUrl) ? (
            <iframe
              title="YouTube player preview"
              src={getYouTubeEmbedUrl(youtubeUrl)}
              width="100%"
              height="240"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : null}
          <div className="delivery-switch" aria-label="Delivery method">
            <button
              className={deliveryMode === 'text' ? 'active' : ''}
              onClick={() => setDeliveryMode('text')}
              type="button"
            >
              Text
            </button>
            <button
              className={deliveryMode === 'voice' ? 'active' : ''}
              onClick={() => setDeliveryMode('voice')}
              type="button"
            >
              Voice
            </button>
          </div>
          <div className="actions">
            {deliveryMode === 'text' ? (
              <a className="primary-action" href={smsLink}>
                Send text
              </a>
            ) : (
              <>
                <button onClick={speakConfession} type="button">
                  Play voice
                </button>
                <button className="secondary" onClick={stopVoice} type="button">
                  Stop
                </button>
              </>
            )}
            <button
              className="secondary"
              onClick={() => navigator.clipboard?.writeText(confession)}
              type="button"
            >
              Copy draft
            </button>
          </div>
          <div className="private-share">
            <div>
              <h3>Private QR link</h3>
              <p>
                Generate an encrypted link and share the access code only with
                the recipient.
              </p>
            </div>
            <button className="secondary full-width" onClick={createPrivateShare} type="button">
              Generate QR and link
            </button>
            {shareLink ? (
              <div className="share-result">
                <img alt="Private confession QR code" src={shareQr} />
                <label className="field">
                  <span>Private link</span>
                  <input readOnly value={shareLink} />
                </label>
                <label className="field">
                  <span>Access code</span>
                  <input readOnly value={accessCode} />
                </label>
                <div className="actions compact">
                  <button
                    className="secondary"
                    onClick={() => navigator.clipboard?.writeText(shareLink)}
                    type="button"
                  >
                    Copy link
                  </button>
                  <button
                    className="secondary"
                    onClick={() => navigator.clipboard?.writeText(accessCode)}
                    type="button"
                  >
                    Copy code
                  </button>
                </div>
                <p className="privacy-note">
                  Anyone with both the link and code can open it. Send the code
                  separately for better privacy.
                </p>
                <div className="field">
                  <span>Receiver status</span>
                  <div className="private-share">
                    <p><strong>Received:</strong> {senderStatus.received ? 'Yes' : 'No'}</p>
                    <p><strong>Viewed:</strong> {senderStatus.viewed ? 'Yes' : 'No'}</p>
                  </div>
                </div>
                <div className="field">
                  <span>Chat with receiver</span>
                  <div className="private-share chat-thread" style={chatInlineStyle}>
                    {threadMessages.length === 0 ? (
                      <p className="privacy-note">Waiting for receiver response to start chat.</p>
                    ) : (
                      threadMessages.map(renderChatMessage)
                    )}
                  </div>
                  <textarea
                    rows="2"
                    value={senderChatText}
                    onChange={(event) => setSenderChatText(event.target.value)}
                    placeholder="Type your message"
                    disabled={!threadMessages.some((msg) => msg.role === 'receiver')}
                  />
                  <button
                    className="secondary"
                    type="button"
                    disabled={!threadMessages.some((msg) => msg.role === 'receiver')}
                    onClick={async () => {
                      const result = await postChatMessage(currentShareId, 'sender', senderChatText, senderChatPremium);
                      if (result.ok) {
                        setSenderChatText('');
                        setChatStatus('Message sent.');
                      } else if (result.reason === 'limit') {
                        setChatStatus('Free chat limit reached (10 messages). Avail premium for unlimited chat.');
                      }
                    }}
                  >
                    Send message
                  </button>
                </div>
                <p className="privacy-note">{chatStatus}</p>
              </div>
            ) : (
              <p className="privacy-note">{shareStatus || 'No private link generated yet.'}</p>
            )}
          </div>
          <div className="private-share">
            <div>
              <h3>Receiver Profile Customization</h3>
              <p>
                Set receiver display profile that appears when the message is opened.
              </p>
            </div>
            <label className="field">
              <span>Nickname</span>
              <input
                value={receiverProfileDraft.nickname}
                onChange={(event) =>
                  setReceiverProfileDraft((current) => ({
                    ...current,
                    nickname: event.target.value,
                  }))
                }
                placeholder="Receiver alias"
              />
            </label>
            <label className="field">
              <span>Bio</span>
              <textarea
                rows="2"
                value={receiverProfileDraft.bio}
                onChange={(event) =>
                  setReceiverProfileDraft((current) => ({
                    ...current,
                    bio: event.target.value,
                  }))
                }
                placeholder="Short description"
              />
            </label>
            <label className="field">
              <span>Theme</span>
              <select
                value={receiverProfileDraft.theme}
                onChange={(event) =>
                  setReceiverProfileDraft((current) => ({
                    ...current,
                    theme: event.target.value,
                  }))
                }
              >
                <option value="classic">Classic</option>
                <option value="sunrise">Sunrise</option>
                <option value="midnight">Midnight</option>
              </select>
            </label>
            <button className="secondary full-width" onClick={saveReceiverProfile} type="button">
              Save receiver profile
            </button>
            <p className="privacy-note">{profileStatus || 'No profile updates yet.'}</p>
          </div>
          <dl className="stats">
            <div>
              <dt>Privacy</dt>
              <dd>Anonymous sender</dd>
            </div>
            <div>
              <dt>Length</dt>
              <dd>{confession.length} chars</dd>
            </div>
          </dl>
        </aside>
      </section>
      <button
        className="feedback-fab"
        type="button"
        onClick={() => setIsFeedbackOpen((current) => !current)}
        aria-expanded={isFeedbackOpen}
        aria-controls="feedback-panel"
      >
        Feedback
      </button>
      {isFeedbackOpen ? (
        <aside className="feedback-panel" id="feedback-panel" aria-label="Feedback panel">
          <form onSubmit={submitFeedback} className="feedback-form">
            <h3>Share feedback</h3>
            <label className="field">
              <span>Feedback</span>
              <textarea
                rows="3"
                value={feedbackText}
                onChange={(event) => setFeedbackText(event.target.value)}
                placeholder="Tell us what to improve"
              />
            </label>
            <label className="field">
              <span>Email (optional)</span>
              <input
                type="email"
                value={feedbackEmail}
                onChange={(event) => setFeedbackEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <div className="actions compact">
              <button type="submit">Send</button>
              <button className="secondary" type="button" onClick={() => setIsFeedbackOpen(false)}>
                Close
              </button>
            </div>
            <p className="privacy-note" role="status" aria-live="polite">
              {feedbackStatus}
            </p>
          </form>
        </aside>
      ) : null}
    </main>
  );
}

export default App;
