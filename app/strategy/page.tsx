"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  useGame,
  formatKRW,
  formatTime,
  MOCK_PARTICIPANT_COUNT,
  MOCK_SPECTATOR_COUNT,
} from "../context/GameContext";
import { ProductThumb } from "../components/ProductImage";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const AVATAR_GRADIENTS = [
  "from-orange-400 to-amber-400",
  "from-pink-400 to-rose-400",
  "from-violet-400 to-purple-400",
  "from-blue-400 to-cyan-400",
  "from-emerald-400 to-teal-400",
  "from-sky-400 to-blue-400",
];

function avatarGradient(nickname: string) {
  return AVATAR_GRADIENTS[nickname.charCodeAt(0) % AVATAR_GRADIENTS.length];
}

// 210 unique lounge messages across 8 personality types
const LOUNGE_MESSAGES: { nickname: string; message: string }[] = [
  // Excited
  { nickname: "쇼핑고수",    message: "드디어 시작이네요 🎉" },
  { nickname: "라이브팬",    message: "오늘 기대 많이 됩니다!" },
  { nickname: "득템요정",    message: "이거 꼭 갖고 싶었어요!" },
  { nickname: "설레는밤",    message: "두근두근 떨려요" },
  { nickname: "행운아123",   message: "드디어!" },
  { nickname: "기다렸다",    message: "기다렸던 라이브예요 ㅎㅎ" },
  { nickname: "운좋을듯",    message: "오늘 운 좋을 것 같아요!" },
  { nickname: "happy_live",  message: "설레네요 진짜로" },
  { nickname: "라이브킹",    message: "오오오 시작한다!" },
  { nickname: "sunny_star",  message: "완전 기대돼요" },
  { nickname: "알람설정완료", message: "이거 보려고 알람 맞춰뒀어요" },
  { nickname: "드디어왔다",  message: "드디어 왔네요 ㅋㅋ" },
  { nickname: "꼭가져간다",  message: "오늘 꼭 가져갑니다!" },
  { nickname: "짜릿해요",    message: "짜릿하다~" },
  { nickname: "기분좋은날",  message: "오늘 기분이 좋아요!" },
  { nickname: "주말쇼핑",    message: "주말에 기분 전환으로 왔어요 ㅎ" },
  { nickname: "설거지중달려옴", message: "라이브 켜놓고 설거지 하다 달려왔어요 ㅋㅋ" },
  { nickname: "느낌좋아",    message: "오늘 뭔가 될 것 같은 느낌적 느낌" },
  { nickname: "입장완료",    message: "입장!" },
  { nickname: "반갑습니다",  message: "다들 안녕하세요 반갑습니다 😊" },
  { nickname: "왔어요ㅎ",    message: "ㅎㅎㅎ 왔어요" },
  { nickname: "오늘대통",    message: "오늘 운수 대통이에요 분명히" },
  { nickname: "가슴쿵쿵",    message: "가슴이 쿵쿵거려요 ㅎ" },
  { nickname: "신나요",      message: "이런 거 처음인데 너무 신나요" },
  { nickname: "설렘가득",    message: "오늘 뭔가 좋은 일 있을 것 같아요 ✨" },

  // Impatient
  { nickname: "빨리빨리",     message: "빨리 시작하죠" },
  { nickname: "언제해요",     message: "언제 시작해요?" },
  { nickname: "기다리기힘들어", message: "기다리는 거 힘들다" },
  { nickname: "1분이영원",    message: "1분이 이렇게 길 줄이야" },
  { nickname: "내려가라",     message: "얼른 가격 내려가라" },
  { nickname: "제일힘든거",   message: "기다리는 게 제일 힘들어요" },
  { nickname: "시간안가",     message: "시간이 왜이렇게 안 가냐 ㅋㅋ" },
  { nickname: "초조해요",     message: "초조하네요" },
  { nickname: "아빨랑",       message: "아 빨랑" },
  { nickname: "10분같다",     message: "1분이 10분 같다" },
  { nickname: "언제언제",     message: "언제요 언제" },
  { nickname: "어서어서",     message: "어서어서" },
  { nickname: "빨리시작해요", message: "얼른 시작해줘요 ㅠ" },
  { nickname: "왜이렇게느려", message: "왜 이렇게 시간이 느리냐고요" },
  { nickname: "초단위로봐",   message: "초 단위로 보고 있어요" },
  { nickname: "기다리다늙겠다", message: "기다리다 늙겠다 ㅋㅋ" },
  { nickname: "저만이런가",   message: "다들 기다리죠? 저만 이런 거 아니죠?" },
  { nickname: "눈빠지겠어",   message: "타이머 보다가 눈 빠지겠어요" },
  { nickname: "내려가라2",    message: "빨리 가격 떨어져라~" },
  { nickname: "초조함중",     message: "초조함을 느끼는 중" },
  { nickname: "언제시작이에요", message: "언제 시작이에요 진짜" },
  { nickname: "30초도길어",   message: "30초도 이렇게 길다니" },
  { nickname: "두근두근기다", message: "두근두근 얼른 시작됐으면 ㅎ" },

  // Optimistic
  { nickname: "좋은가격나올듯", message: "오늘 좋은 가격 나올 것 같아요" },
  { nickname: "좋은결과기대",   message: "다들 좋은 결과 있길 바랍니다" },
  { nickname: "기분좋게낙찰",   message: "기분 좋게 낙찰받아 봐요" },
  { nickname: "분위기좋다",     message: "오늘 분위기 좋네요" },
  { nickname: "같이즐겨요",     message: "다같이 즐겨봐요 ㅎㅎ" },
  { nickname: "잘될것같아",     message: "잘 될 것 같은 느낌이에요" },
  { nickname: "긍정파워",       message: "긍정적으로 생각해요!" },
  { nickname: "될것같아요",     message: "오늘 뭔가 될 것 같아요" },
  { nickname: "행운빌어요",     message: "다들 원하는 가격에 잡으세요 😊" },
  { nickname: "훈훈해요",       message: "분위기 훈훈하네요 ㅎ" },
  { nickname: "화이팅123",      message: "다들 화이팅이에요!" },
  { nickname: "좋은하루",       message: "좋은 하루 되세요" },
  { nickname: "긍정충전완료",   message: "긍정 에너지 충전 완료" },
  { nickname: "다잘될거야",     message: "다 잘 될 거예요 ㅎㅎ" },
  { nickname: "누군가행운",     message: "오늘 누군가는 정말 행운이겠네요" },
  { nickname: "좋은쇼핑되길",   message: "좋은 쇼핑 되시길" },
  { nickname: "좋아좋아",       message: "좋아요 좋아 👍" },
  { nickname: "기분업",         message: "분위기가 좋아서 기분 업되네요" },
  { nickname: "즐거운경험",     message: "즐거운 경험이 될 것 같아요" },
  { nickname: "파이팅",         message: "다들 파이팅!" },
  { nickname: "모두화이팅",     message: "모두 화이팅! 😊" },
  { nickname: "좋은경험",       message: "좋은 경험이 되고 있어요" },
  { nickname: "응원해요",       message: "다들 응원해요 ㅎㅎ" },

  // Cautious
  { nickname: "얼마까지갈까",  message: "이거 어디까지 내려갈까요" },
  { nickname: "다들어디까지",  message: "다들 어디까지 생각하시나요?" },
  { nickname: "너무빨리안돼",  message: "너무 빨리 누르면 안 되겠죠?" },
  { nickname: "여유있게",      message: "아직은 여유 있는 듯" },
  { nickname: "지켜볼게요",    message: "조금 더 지켜볼게요" },
  { nickname: "신중하게",      message: "신중하게 가야죠" },
  { nickname: "급하지않아",    message: "급하게 누르면 안 되는 거죠?" },
  { nickname: "타이밍중요",    message: "타이밍이 중요하겠네요" },
  { nickname: "더내려가길",    message: "좀 더 내려가길 기대하고 있어요" },
  { nickname: "지켜보며결정",  message: "지켜보면서 결정할게요" },
  { nickname: "최저까지",      message: "최저가까지 기다려볼까요" },
  { nickname: "아직이를까",    message: "아직 더 내려갈 수 있지 않을까요" },
  { nickname: "신중신중",      message: "신중하게 봐야 할 것 같아요" },
  { nickname: "천천히가요",    message: "천천히 가봐요" },
  { nickname: "최적타이밍",    message: "최적의 타이밍을 잡아야죠" },
  { nickname: "더내려가라",    message: "조금 더 내려가길 바라고 있어요" },
  { nickname: "합리적가격",    message: "얼마 정도면 합리적인 가격일까요?" },
  { nickname: "서두르지않아",  message: "서두르지 않겠어요" },
  { nickname: "느긋하게",      message: "느긋하게 지켜볼게요" },
  { nickname: "아직때아냐",    message: "아직 때가 아닌 것 같아요" },
  { nickname: "참을성",        message: "참을성을 발휘해야 할 때네요" },
  { nickname: "신중파",        message: "너무 급하게 판단하면 안 될 것 같아요" },
  { nickname: "기다려야지",    message: "좀 더 기다리는 게 맞을 것 같아요" },

  // Funny
  { nickname: "처음이에요ㅋ",   message: "ㅋㅋㅋㅋ 오늘 처음 해봅니다" },
  { nickname: "ㅋㅋ유저",       message: "ㅋㅋ" },
  { nickname: "ㅎㅎ입장",       message: "ㅎㅎ 왔습니다" },
  { nickname: "뭐야이거",       message: "뭐야 이거 재밌네 ㅋㅋ" },
  { nickname: "채팅재밌다",     message: "채팅창 은근 재밌네요 ㅋㅋ" },
  { nickname: "숨참는중",       message: "다들 숨참고 계시는 거 알아요 ㅋㅋ" },
  { nickname: "심장입으로",     message: "심장이 입으로 나올 것 같아 ㅋㅋ" },
  { nickname: "준비운동중",     message: "손가락 준비운동 중입니다 ㅋㅋ" },
  { nickname: "물한잔",         message: "긴장해서 물 한 잔 마시고 왔어요 ㅋ" },
  { nickname: "과자먹는중",     message: "이거 보면서 과자 먹는 중 ㅋㅋ" },
  { nickname: "와이파이확인3회", message: "와이파이 확인 3번 함 ㅋㅋ" },
  { nickname: "배터리100",      message: "폰 배터리 100% 충전하고 왔어요 ㅋ" },
  { nickname: "조퇴하고옴",     message: "오늘 회사 조퇴하고 왔습니다 ㅋㅋ" },
  { nickname: "급히달려왔어",   message: "자고 일어났더니 라이브 해서 급히 달려왔어요 ㅋ" },
  { nickname: "밥빨리먹음",     message: "이거 보려고 밥 빨리 먹었어요 ㅋ" },
  { nickname: "오유저",         message: "오" },
  { nickname: "ㅋㅋ유저2",      message: "ㅋㅋㅋ" },
  { nickname: "오오유저",       message: "오오" },
  { nickname: "와유저",         message: "와" },
  { nickname: "재밌다ㅋ",       message: "ㅋㅋㅋㅋ 여기 재밌다" },
  { nickname: "나만긴장",       message: "나만 긴장됨? ㅋㅋ" },
  { nickname: "손떨려ㅋ",       message: "손 떨려 ㅋㅋ" },
  { nickname: "진짜냐ㅋ",       message: "이거 진짜냐 ㅋㅋ 신기해" },
  { nickname: "심장터질것",     message: "ㅋㅋㅋ 심장 터질 것 같아요" },
  { nickname: "일정공유해줘",   message: "다음에 또 할 거면 일정 공유해 주세요 ㅋㅋ" },
  { nickname: "표정봤으면",     message: "다들 표정 봤으면 ㅋㅋ" },
  { nickname: "ㄷㄷ유저",       message: "ㄷㄷ" },
  { nickname: "이러다먼저눌러", message: "이러다 손이 먼저 나가겠다 ㅋㅋ" },

  // Parents
  { nickname: "아이아빠",    message: "아이가 좋아할 것 같아요" },
  { nickname: "주말나들이",  message: "주말에 타면 좋겠네요" },
  { nickname: "생일선물",    message: "아이 생일 선물로 사려고요" },
  { nickname: "딸맘",        message: "딸이 엄청 갖고 싶어 했어요" },
  { nickname: "아들아빠",    message: "아들한테 사줄 거예요" },
  { nickname: "자전거아이",  message: "아이가 자전거 좋아해서 왔어요" },
  { nickname: "주말나들이맘", message: "주말 나들이에 딱이겠다 싶어서요" },
  { nickname: "아이반짝",    message: "아이 눈이 반짝반짝할 것 같아요" },
  { nickname: "달려온엄마",  message: "엄마가 아이 때문에 달려왔어요 ㅎ" },
  { nickname: "아이선물",    message: "아이한테 서프라이즈로 주고 싶어요" },
  { nickname: "공원타요",    message: "집 앞 공원에서 타면 딱이겠어요" },
  { nickname: "졸랐거든요",  message: "아이가 달라고 계속 졸랐거든요 ㅎ" },
  { nickname: "아이선물고민", message: "아이 선물 고민하다 여기 오게 됐어요" },
  { nickname: "운동시켜야지", message: "요즘 아이들 운동도 시켜야 하는데 딱이죠" },
  { nickname: "어린이날",    message: "어린이날 선물로 생각 중이에요" },
  { nickname: "아이표정",    message: "아이 표정 기대하면서 왔어요 ㅎ" },
  { nickname: "깜짝선물맘",  message: "아이한테 깜짝 선물이 되면 좋겠어요" },
  { nickname: "엄마표서프",  message: "엄마표 서프라이즈 준비 중 ㅎㅎ" },
  { nickname: "아이설레요",  message: "아이 눈빛 생각하니 설레요" },
  { nickname: "가족라이딩",  message: "주말에 가족이 함께 쓸 수 있을 것 같아요" },
  { nickname: "요즘애들",    message: "요즘 애들 이런 거 좋아하잖아요" },
  { nickname: "우리아이",    message: "우리 아이 생각하면서 여기 왔어요" },
  { nickname: "아이키우면서", message: "아이 키우다 보면 이런 거 하나쯤은" },
  { nickname: "아이랑같이",  message: "아이랑 같이 타면 좋겠어요" },
  { nickname: "아이행복",    message: "아이가 행복해하는 모습 상상 중이에요 ㅎ" },

  // Bargain hunters
  { nickname: "솔직히비싸",   message: "250,000원이면 솔직히 비싸긴 하죠" },
  { nickname: "20만밑으로",   message: "20만원 밑으로 가면 바로 누를게요" },
  { nickname: "사려고왔어",   message: "이거 사려고 들어왔습니다" },
  { nickname: "끝까지기다",   message: "오늘은 끝까지 기다려봅니다" },
  { nickname: "최저가도전",   message: "최저가 도전 중" },
  { nickname: "얼마까지가나", message: "얼마까지 내려가는지 지켜볼게요" },
  { nickname: "가성비파",     message: "가성비 파라 부릅니다" },
  { nickname: "싸게사면기분", message: "싸게 사면 기분이 두 배로 좋더라고요" },
  { nickname: "150되면바로",  message: "150,000원 나오면 바로요 ㅋ" },
  { nickname: "알뜰하게",     message: "알뜰하게 가보겠습니다" },
  { nickname: "최저달성",     message: "최저 달성하면 바로 낙찰" },
  { nickname: "아끼면좋지",   message: "아끼면 나중에 다른 데 쓸 수 있잖아요" },
  { nickname: "절약미덕",     message: "절약이 미덕이죠 ㅎㅎ" },
  { nickname: "고수는기다려", message: "끝까지 기다리는 게 진짜 고수 아닌가요" },
  { nickname: "참을인셋",     message: "참을 인 자 셋이면 성공한다고 했어요 ㅋ" },
  { nickname: "알뜰고수",     message: "알뜰 쇼핑 고수로서 말씀드리면 기다리는 게 맞아요" },
  { nickname: "심장뛰어요",   message: "가격이 내려갈수록 심장이 뛰어요 ㅋㅋ" },
  { nickname: "최대한낮게",   message: "최대한 낮은 가격에 노려봅니다" },
  { nickname: "두눈크게",     message: "얼마나 내려가는지 두 눈 크게 뜨고 봅니다" },
  { nickname: "이왕사는거",   message: "이왕 사는 거 싸게 사야죠" },
  { nickname: "싸면제일행복", message: "싸게 사면 제일 행복하잖아요 ㅎ" },
  { nickname: "가격소리들려", message: "가격 떨어지는 소리 들리는 것 같아요 ㅋ" },
  { nickname: "정가비교함",   message: "이거 정가 알아봤는데 여기가 훨씬 나은 것 같아요" },
  { nickname: "가격보고또봐", message: "가격 한번 보고 또 보고 ㅋ" },
  { nickname: "싸야한다",     message: "제가 봤을 땐 좀 더 내려가야 할 것 같아요" },

  // First-timers
  { nickname: "오늘첫도전",   message: "처음이라 긴장되네요" },
  { nickname: "어떻게하나",   message: "어떻게 하는 건지 알 것 같아요" },
  { nickname: "첫참여자",     message: "첫 참여입니다 잘 부탁드려요" },
  { nickname: "사람많다",     message: "생각보다 사람 많네요" },
  { nickname: "관전자많다",   message: "관전자도 엄청 많네요" },
  { nickname: "친구듣고왔어", message: "친구한테 듣고 한번 해봤어요" },
  { nickname: "성공할까요",   message: "처음인데 성공할 수 있을까요? ㅎ" },
  { nickname: "타이밍언제",   message: "어떤 타이밍에 눌러야 하는 건가요?" },
  { nickname: "잘모르겠어",   message: "처음이라 잘 모르겠어요" },
  { nickname: "채팅보는게",   message: "이 채팅창 보고 있는 것만으로도 재밌어요" },
  { nickname: "배송언제",     message: "낙찰 되면 바로 배송되는 건가요?" },
  { nickname: "다경험자",     message: "다들 경험자세요?" },
  { nickname: "뭔가설레",     message: "처음인데 뭔가 설레요 ㅎ" },
  { nickname: "자주하나요",   message: "이거 자주 하는 건가요?" },
  { nickname: "잘부탁",       message: "처음이지만 잘 부탁드려요" },
  { nickname: "신기한쇼핑",   message: "신기한 쇼핑 방식이네요" },
  { nickname: "어떻게시작",   message: "어떻게 시작하게 됐어요?" },
  { nickname: "저만처음아냐", message: "저만 처음인 게 아닌 것 같아서 다행이에요 ㅋ" },
  { nickname: "첫낙찰도전",   message: "첫 번에 낙찰 받을 수 있을까요 ㅎ" },
  { nickname: "긴장재밌어",   message: "긴장되는데 재밌어요" },
  { nickname: "처음봤어요",   message: "이런 방식 처음 봤어요" },
  { nickname: "newbie_kr",    message: "ㅋㅋㅋㅋ 오늘 처음 해봅니다" },
  { nickname: "초보자입니다", message: "처음인데 재밌겠네요" },
  { nickname: "눈팅하다",     message: "초보라 눈팅하다 채팅 남겨요 ㅎ" },
  { nickname: "입문중",       message: "이거 어떻게 알고 오셨어요? 신기하다" },

  // Extra variety
  { nickname: "재밌네요",     message: "이거 생각보다 재밌어요" },
  { nickname: "다음에도",     message: "다음에도 또 참여할게요" },
  { nickname: "누비자전거",   message: "누비 자전거 괜찮아 보이네요" },
  { nickname: "커뮤니티",     message: "이런 라이브 더 자주 했으면 좋겠어요" },
  { nickname: "다들모여라",   message: "다들 안녕하세요 ㅎ" },
  { nickname: "오래갈듯",     message: "오늘 오래 갈 것 같은데요" },
  { nickname: "구경꾼99",     message: "구경만 하다 채팅 합니다 ㅋ" },
  { nickname: "이거진짜야",   message: "이거 진짜 라이브라 신기해요" },
  { nickname: "소확행",       message: "이런 소소한 즐거움이 좋아요 ㅎ" },
  { nickname: "밤의쇼핑",     message: "다들 안 주무시고 계셨군요" },
  { nickname: "라이브러버",   message: "라이브 쇼핑 너무 좋아요" },
  { nickname: "현명한구매",   message: "좋은 가격에 좋은 물건 사는 게 최고죠" },
];

export default function StrategyPage() {
  const { state, dispatch } = useGame();
  const router = useRouter();
  const [timeLeft, setTimeLeft] = useState(state.config.strategyDuration);
  const [message, setMessage] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scheduleRef = useRef<Array<{ atSecond: number; nickname: string; message: string }>>([]);
  const firedRef = useRef(new Set<number>());

  useEffect(() => {
    if (!state.currentUser) router.replace("/");
  }, [state.currentUser, router]);

  // Generate a random arrival schedule once on mount
  useEffect(() => {
    const pool = shuffle(LOUNGE_MESSAGES);
    const sched: typeof scheduleRef.current = [];
    let t = 1 + Math.floor(Math.random() * 3); // first message at 1-3s
    for (const item of pool) {
      if (t >= 57) break;
      sched.push({ atSecond: t, ...item });
      t += 2 + Math.floor(Math.random() * 5); // 2-6s gap between messages
    }
    scheduleRef.current = sched;
  }, []);

  // Timer + fire lounge messages
  useEffect(() => {
    if (!state.strategyStartedAt) return;

    const update = () => {
      const elapsed = Math.floor(
        (Date.now() - state.strategyStartedAt!) / 1000
      );
      const remaining = Math.max(0, state.config.strategyDuration - elapsed);
      setTimeLeft(remaining);

      scheduleRef.current.forEach((item, idx) => {
        if (elapsed >= item.atSecond && !firedRef.current.has(idx)) {
          firedRef.current.add(idx);
          dispatch({
            type: "SEND_MESSAGE",
            nickname: item.nickname,
            message: item.message,
            timestamp: Date.now(),
          });
        }
      });

      if (remaining === 0) {
        dispatch({ type: "START_GAME", timestamp: Date.now() });
        router.push("/game");
      }
    };

    update();
    const t = setInterval(update, 500);
    return () => clearInterval(t);
  }, [state.strategyStartedAt, state.config.strategyDuration, dispatch, router]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.chatMessages]);

  function sendMessage() {
    if (!message.trim() || !state.currentUser) return;
    dispatch({
      type: "SEND_MESSAGE",
      nickname: state.currentUser.nickname,
      message: message.trim(),
      timestamp: Date.now(),
    });
    setMessage("");
    inputRef.current?.focus();
  }

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  const progress = timeLeft / state.config.strategyDuration;
  const isUrgent = timeLeft <= 15;

  if (!state.currentUser) return null;

  return (
    <main className="h-screen bg-[#fffbf5] flex flex-col max-w-md mx-auto overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 bg-white px-4 pt-10 pb-3 border-b border-gray-100 shadow-sm">

        {/* Top row: lounge title + timer */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              <span className="w-1 h-1 rounded-full bg-white animate-pulse" />
              LIVE
            </span>
            <Image
              src="/rabbit-logo.png"
              alt="Rabbit"
              width={28}
              height={28}
              style={{ width: 28, height: "auto" }}
            />
            <span className="text-gray-900 font-black text-base tracking-tight">
              참가자 라운지
            </span>
          </div>
          {/* Timer */}
          <div className="text-right">
            <div
              className={`text-2xl font-black tabular-nums font-mono leading-none ${
                isUrgent ? "text-red-500" : "text-orange-500"
              }`}
            >
              {pad(mins)}:{pad(secs)}
            </div>
            <p className="text-gray-400 text-[10px] mt-0.5 text-right">라이브 시작까지</p>
          </div>
        </div>

        {/* Product row */}
        <div className="flex items-center gap-2.5 mb-2">
          <ProductThumb alt={state.config.productName} size={40} rounded="rounded-xl" />
          <div className="min-w-0">
            <p className="text-gray-800 text-sm font-semibold truncate leading-tight">
              {state.config.productName}
            </p>
            <p className="text-gray-400 text-xs">
              시작가 {formatKRW(state.config.startPrice)}
            </p>
          </div>
        </div>

        {/* Participant / spectator counts */}
        <div className="flex items-center gap-2 mb-2.5">
          <span className="flex items-center gap-1 bg-orange-50 text-orange-600 text-xs font-semibold px-2.5 py-1 rounded-full border border-orange-100">
            👥 참가자 {MOCK_PARTICIPANT_COUNT.toLocaleString()}명
          </span>
          <span className="flex items-center gap-1 bg-gray-50 text-gray-500 text-xs font-medium px-2.5 py-1 rounded-full border border-gray-100">
            👀 관전자 {MOCK_SPECTATOR_COUNT.toLocaleString()}명
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-orange-50 rounded-full h-1.5 overflow-hidden mb-1">
          <div
            className="h-1.5 rounded-full transition-all duration-1000"
            style={{
              width: `${progress * 100}%`,
              background: isUrgent
                ? "linear-gradient(90deg,#ef4444,#f97316)"
                : "linear-gradient(90deg,#fb923c,#f59e0b)",
            }}
          />
        </div>

        {isUrgent && (
          <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5 text-center">
            <p className="text-amber-600 text-xs font-semibold">
              ⏱ 잠시 후 라이브가 시작됩니다!
            </p>
          </div>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">

        {/* Lounge intro pill */}
        <div className="flex justify-center pb-1">
          <span className="bg-orange-50 text-orange-400 text-xs px-4 py-1.5 rounded-full border border-orange-100 text-center leading-snug">
            라이브 시작 전, 참가자들이 자유롭게 이야기를 나누고 있습니다.
          </span>
        </div>

        {state.chatMessages.map((msg) => {
          const isMe = msg.nickname === state.currentUser?.nickname;

          if (msg.kind === "system") {
            return (
              <div key={msg.id} className="flex justify-center">
                <span className="bg-gray-50 text-gray-400 text-xs px-4 py-1.5 rounded-full border border-gray-100">
                  {msg.message}
                </span>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex gap-2 ${isMe ? "flex-row-reverse" : ""}`}
            >
              {/* Avatar */}
              <div
                className={`w-7 h-7 rounded-full bg-gradient-to-br ${
                  isMe ? "from-orange-400 to-amber-400" : avatarGradient(msg.nickname)
                } flex items-center justify-center text-[10px] font-black text-white flex-shrink-0 shadow-sm`}
              >
                {msg.nickname[0].toUpperCase()}
              </div>

              {/* Bubble */}
              <div
                className={`max-w-[72%] flex flex-col ${isMe ? "items-end" : "items-start"}`}
              >
                <span className="text-[10px] text-gray-400 mb-0.5 px-1">
                  {isMe ? "나" : msg.nickname}
                  <span className="ml-1 text-gray-300">·</span>
                  <span className="ml-1">{formatTime(msg.timestamp)}</span>
                </span>
                <div
                  className={`px-3 py-2 rounded-2xl text-sm leading-snug shadow-sm ${
                    isMe
                      ? "bg-orange-500 text-white rounded-tr-sm"
                      : "bg-white text-gray-800 rounded-tl-sm border border-gray-100"
                  }`}
                >
                  {msg.message}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 bg-white px-4 pt-3 pb-8 border-t border-gray-100 shadow-sm">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="라운지에서 자유롭게 이야기해요 😊"
            className="flex-1 bg-gray-50 border-2 border-gray-100 rounded-2xl px-4 py-3 text-gray-900 placeholder-gray-400 text-sm focus:outline-none focus:border-orange-300 transition-colors min-w-0"
          />
          <button
            onClick={sendMessage}
            disabled={!message.trim()}
            className="bg-orange-500 hover:bg-orange-400 disabled:opacity-30 text-white w-12 rounded-2xl font-bold text-lg flex items-center justify-center transition-colors flex-shrink-0 shadow-sm"
          >
            ↑
          </button>
        </div>
      </div>
    </main>
  );
}
