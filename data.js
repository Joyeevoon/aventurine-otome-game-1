/* ============================================================
   夏日贴纸 · 心动盖章 — 数据定义（唯一需要改的地方）
   坐标为视频画面内的百分比（x% / y%），以 1080×1920 源帧标定
   ============================================================ */
const STICKER_DATA = [
  {
    id: 1,
    target: "face",
    targetName: "脸颊",
    sticker: "assets/stickers/sticker-1.png",
    audio: "assets/audio/audio-1.mp3",
    duration: 2.69,          // 原 MP3 时长（秒）
    dialogue: "哦？偷偷给我盖章呢？",
    narration: "（感受到脸颊的触感，挑眉抬眼，笑意慵懒，顺势微微俯身凑近你）",
    // 脸颊（观众视角左颊，更靠面部中央，仍收在脸缘以内）
    x: 44.3, y: 34.1, size: 11, maxW: 0.09,
  },
  {
    id: 2,
    target: "neck",
    targetName: "脖子",
    sticker: "assets/stickers/sticker-2.png",
    audio: "assets/audio/audio-2.mp3",
    duration: 6.74,          // 原 MP3 时长（秒）
    dialogue: "贴上这个，就是你的人了？那我可得好好带着。毕竟，是专属标记，对吧？",
    narration: "（指尖摩挲脸上的小贴纸，视线牢牢锁住你）",
    // 颈部（下颌之下、项链上方）
    x: 49.5, y: 41.2, size: 13,
  },
  {
    id: 3,
    target: "collarbone",
    targetName: "锁骨",
    sticker: "assets/stickers/sticker-3.png",
    audio: "assets/audio/audio-3.mp3",
    duration: 3.76,          // 原 MP3 时长（秒）
    dialogue: "还不打算收手？打算把我浑身都布满你的印记？",
    narration: "（见你还在不停往他肩头、锁骨接连贴上夏日小贴纸，喉间溢出一声低笑，没有躲闪，反而主动微微敞开肩颈方便你动作）",
    // 锁骨（左肩内侧，观众视角右侧）
    x: 43.5, y: 45.8, size: 15,
  },
  {
    id: 4,
    target: "abs",
    targetName: "腹肌",
    sticker: "assets/stickers/sticker-4.png",
    audio: "assets/audio/audio-4.mp3",
    duration: 2.82,          // 原 MP3 时长（秒）
    dialogue: "这么想宣告占有，倒是一点都不掩饰。",
    narration: "(垂眸望着落在皮肤上五颜六色的贴纸，指节轻叩了叩自己的胸膛，目光沉沉落在你的脸上）",
    // 腹肌（肌腹正中、水面之上）
    x: 49.6, y: 67.4, size: 16,
  },
  {
    id: 5,
    target: "heart",
    targetName: "心口",
    sticker: "assets/stickers/sticker-5.png",
    audio: "assets/audio/audio-5.mp3",
    duration: 4.44,          // 原 MP3 时长（秒）
    dialogue: "那就贴在这里。刻在心上，比贴纸要牢靠得多。",
    narration: "（抬手轻轻扣住你的手腕，却不推开，只将你的手按在自己心口位置）",
    // 心口（心脏位置：角色右侧胸，观众视角偏左）
    x: 56.5, y: 48.4, size: 14,
  },
];

/* 视频（idle / speaking 两态，绝不同时播放） */
const VIDEO_SRC = {
  idle: "assets/video/idle.mp4",
  speaking: "assets/video/speaking.mp4",
};

/* 背景音乐（默认自动播放，可开关） */
const BGM_SRC = "assets/audio/bgm.mp3";
const BGM_VOLUME = 0.45;

/* 好感度：每张贴 +20 */
const AFFECTION_PER_STICKER = 20;

/* 尺寸系数：贴纸贴到身上后大小（本轮 ×1.3 放大） */
const PLACE_SCALE = 0.585;
/* 圆点尺寸缩放（本轮缩小 30%） */
const DOT_SCALE = 0.7;
