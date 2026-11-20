// 게임 속 글과 카드 자료 (원작 문장을 옮기지 않고 새로 씀)

export const TOP = 7;
export const BOTTOM = -25;
export const START_FLOOR = 4;

export const MANUAL = [
  '안녕하세요, 손님.',
  '이 안내문을 끝까지 읽어 주셔서 감사합니다. 이제 어느 길로 가시든 저희 전시회에 닿으실 겁니다.',
  '관람은 첫 한 시간 동안 무료입니다.',
  '전시홀에서는 뛰지 마시고, 전시품에 손대지 마십시오.',
  '비상문은 모두 올바르게 표시되어 있습니다. 원하실 때 언제든 나가실 수 있습니다.',
  '107번째 손님을 진심으로 환영합니다.',
];

// 카드 12장. pw: 목적 자리에 놓였을 때 이름 앞말, en: 본질 자리에 놓였을 때 이름 뒷말
export const CARDS = [
  { k: '명예', sym: '★', pw: '고귀함', en: '귀빈', fx: 'ignore', d: '안내원이 쫓아오지 않음' },
  { k: '방해', sym: '✖', pw: '훼방', en: '훼방꾼', fx: 'slow', d: '안내원이 느려짐' },
  { k: '혼란', sym: '❖', pw: '혼돈', en: '교란자', fx: 'confuse', d: '안내원이 나를 못 알아봄' },
  { k: '치유', sym: '✚', pw: '회복', en: '치유사', fx: 'heal', d: '켜는 순간 인공 부위가 모두 고쳐짐' },
  { k: '명상', sym: '☾', pw: '고요', en: '은둔자', fx: 'silent', d: '발소리가 나지 않음' },
  { k: '상처', sym: '✂', pw: '흉터', en: '순교자', fx: 'martyr', d: '안내원이 못 본 척함, 인공 부위가 빨리 닳음' },
  { k: '거짓', sym: '♥', pw: '허상', en: '사칭자', fx: 'disguise', d: '안내원이 손님으로 착각함, 더 오래 탐' },
  { k: '꿈', sym: '☁', pw: '몽상', en: '몽유자', fx: 'dream', d: '시간이 느리게 흐름' },
  { k: '분노', sym: '♨', pw: '격노', en: '불씨', fx: 'repel', d: '안내원이 불을 피함' },
  { k: '보호', sym: '◈', pw: '수호', en: '방패', fx: 'shield', d: '징수를 한 번 대신 막음' },
  { k: '일격', sym: '⚔', pw: '단숨', en: '처형자', fx: 'stun', d: '다가온 안내원 하나를 멈춤' },
  { k: '응시', sym: '◉', pw: '눈길', en: '감시자', fx: 'xray', d: '벽 너머 안내원이 보임' },
];
export const CARD_MAP = Object.fromEntries(CARDS.map((c) => [c.k, c]));

// 쪽지: 층마다 정해진 자리에 놓임
export const NOTES = [
  { id: 'n1', floor: 4, title: '구겨진 쪽지', text: '양초 키트는 지하 1층 라운지에서 써. 거기엔 그것들이 안 들어와.\n카드 두 장은 뽑히는 대로, 마지막 한 장은 직접 고르는 거야.\n세 장 중에 [거짓]이 들어가 있어야 그것들한테 말을 걸 수 있어.' },
  { id: 'n7', floor: 4, title: '찢어진 수첩', text: '한 시간이 지나면 그것들이 요금을 받으러 온다.\n그 전까지는 얌전히만 있으면 된다. 전시실에서 뛰지 말고, 진열장에 손대지 말 것.' },
  { id: 'n2', floor: -1, title: '관람 메모', text: '안내원은 자기가 맡은 층밖에 몰라.\n출구를 물으면 그 층에서 위인지 아래인지만 알려 준다.\n끄덕이면 맞다는 뜻, 가만히 있으면 아니라는 뜻.' },
  { id: 'n8', floor: -1, title: '라운지 탁자 위 메모', text: '벽난로 앞 의자에 앉아 있으면 시간이 빨리 간다.\n양초가 굳기를 기다릴 땐 좋은데, 무료 시간도 같이 간다는 걸 잊지 마.' },
  { id: 'n3', floor: 2, title: '피 묻지 않은 쪽지', text: '같은 안내원한테 자꾸 묻지 마.\n거짓말은 할수록 얇아진다. 나는 세 번째에 들켰다.' },
  { id: 'n4', floor: 1, title: '연필 낙서', text: '엘리베이터 버튼판을 다시 봤다.\n1층 버튼과 지하 1층 버튼 사이에 뭔가 뜯겨 나간 자리가 있다.\n왜 거기만 비어 있지?' },
  { id: 'n6', floor: 5, title: '손님 명부 한 장', text: '게스트룸 침대가 너무 푹신해 보였다.\n눕지 마. 누운 사람은 아무도 안 일어났어.' },
  { id: 'n5', floor: -3, title: '젖은 편지', text: '이 저택 주인은 바다 건너에서 왔다고 한다.\n그쪽 사람들은 땅에 닿은 층을 1층이라고 부르지 않는다던데.' },
];

// 징수 순서 (원작에서 가장 먼저 가져가는 건 눈)
export const SLOTS = [
  { slot: 'eyeL', kind: 'eye', label: '왼쪽 눈', art: '인공 렌즈' },
  { slot: 'earR', kind: 'ear', label: '오른쪽 귀', art: '인공 고막' },
  { slot: 'armL', kind: 'arm', label: '왼팔', art: '의수' },
  { slot: 'legR', kind: 'leg', label: '오른 다리', art: '의족' },
  { slot: 'eyeR', kind: 'eye', label: '오른쪽 눈', art: '인공 렌즈' },
  { slot: 'earL', kind: 'ear', label: '왼쪽 귀', art: '인공 고막' },
  { slot: 'armR', kind: 'arm', label: '오른팔', art: '의수' },
  { slot: 'legL', kind: 'leg', label: '왼 다리', art: '의족' },
];

export const ENDINGS = {
  escape: { title: '귀가', lines: ['비상문 너머에서 바깥 공기가 밀려 들어왔다.', '107번째 관람 기록: 무사히 귀가.'] },
  exhibit: { title: '신규 소장품', lines: ['더는 걸을 수도, 들을 수도 없다.', '누군가 나를 액자 크기에 맞춰 세운다.', '107번째 관람 기록: 전시 중.'] },
  guest: { title: '장기 투숙', lines: ['침대는 생각보다 훨씬 깊었다.', '107번째 관람 기록: 게스트룸에 머무는 중.'] },
};

// 게임 수치 (게임 시간은 분 단위)
export const CFG = {
  timeScale: 4,          // 실제 1초 = 게임 4초
  freeMin: 60,           // 무료 관람 시간
  partLife: 30,          // 인공 부위 수명
  hardenMin: 30,         // 양초 굳는 시간
  waxBase: 24,           // 혼자 만든 양초가 타는 시간
  waxLieBonus: 12,       // 본질이 거짓이면 더 탐
  askCost: 2,            // 질문 한 번에 타는 양
  craftCost: 4,          // 양초 만드는 데 드는 시간
  restScale: 10,         // 벽난로 앞에서 쉴 때 시간 배속
  walk: 3.0, run: 5.2, crawl: 0.95, stamina: 4.5,
};
