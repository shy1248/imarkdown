import { useState, useEffect, useRef } from 'react';
import { t } from '../i18n';

interface EmojiPickerProps {
    anchorRect: DOMRect;
    onSelect: (emoji: string) => void;
    onClose: () => void;
}

interface EmojiCategory {
    labelKey: string;
    icon: string;
    rows: string[][];
}

const EMOJI_CATEGORIES: EmojiCategory[] = [
    { labelKey: 'emoji.cat.smileys', icon: '😀', rows: [
        ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇'],
        ['🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚'],
        ['😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸'],
        ['🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️'],
        ['😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡'],
        ['🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗'],
        ['🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯'],
        ['😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤢'],
        ['🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','💀'],
        ['☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','🎃'],
    ]},
    { labelKey: 'emoji.cat.gestures', icon: '👍', rows: [
        ['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','🫷'],
        ['👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈'],
        ['👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊'],
        ['🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️'],
        ['💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃'],
    ]},
    { labelKey: 'emoji.cat.people', icon: '👶', rows: [
        ['👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓'],
        ['👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇'],
        ['🤦','🤷','👮','🕵️','💂','🥷','👷','🤴','👸','👰'],
        ['🤵','🎅','🤶','🧙','🧝','🧛','🧟','🧞','🧜','🧚'],
    ]},
    { labelKey: 'emoji.cat.animals', icon: '🐶', rows: [
        ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯'],
        ['🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧'],
        ['🐦','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝'],
        ['🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷️','🦂','🐢'],
        ['🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡'],
        ['🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓'],
        ['🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘'],
    ]},
    { labelKey: 'emoji.cat.food', icon: '🍎', rows: [
        ['🍎','🍊','🍋','🍇','🍓','🫐','🍈','🍑','🥭','🍍'],
        ['🥥','🥝','🍅','🥑','🍆','🥦','🥬','🥒','🌶️','🫑'],
        ['🧄','🧅','🥔','🍠','🧆','🥚','🍳','🧇','🥞','🧈'],
        ['🍞','🥐','🥖','🥨','🥯','🧀','🥗','🥙','🌮','🌯'],
        ['🫔','🥪','🍕','🍔','🌭','🍟','🍿','🧂','🍱','🍜'],
        ['🍝','🍛','🍣','🍤','🍙','🍚','🍘','🍥','🥟','🦪'],
        ['🍦','🍧','🍨','🍰','🎂','🍮','🍭','🍬','🍫','🍩'],
        ['🍪','🌰','🥜','🍯','☕','🫖','🍵','🧃','🥤','🧋'],
        ['🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾','🫗'],
    ]},
    { labelKey: 'emoji.cat.activities', icon: '🏀', rows: [
        ['🏀','🏈','🥎','🎾','🏐','🏉','🥏','🎱','🏆','🥇'],
        ['🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🎣'],
        ['🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','⛷️'],
        ['🏂','🪂','🏋️','🤼','🤸','⛹️','🤺','🏇','🧘','🧗'],
        ['🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🪘'],
        ['🎷','🎸','🎺','🎻','🪕','🎮','🎲','🎯'],
    ]},
    { labelKey: 'emoji.cat.travel', icon: '🚀', rows: [
        ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐'],
        ['🛻','🚚','🚛','🚜','🏍️','🛵','🚲','🛴','🛺','🚁'],
        ['✈️','🚀','🛸','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢'],
        ['🚂','🚃','🚄','🚅','🚆','🚇','🚈','🚉','🚊','🚋'],
        ['🌍','🌎','🌏','🌐','🗺️','🧭','🏔️','⛰️','🌋','🗻'],
        ['🏕️','🏖️','🏜️','🏝️','🏞️','🏟️','🏛️','🏗️','🏘️','🏚️'],
        ['🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪'],
    ]},
    { labelKey: 'emoji.cat.symbols', icon: '❤️', rows: [
        ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔'],
        ['❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️'],
        ['✨','🌟','⭐','💫','🔥','💥','❄️','🌈','☁️','⛈️'],
        ['🎉','🎊','🎈','🎀','🎁','🏅','🥇','🥈','🥉','🏆'],
        ['💯','✅','❌','⭕','❓','❗','💬','💭','🔔','📢'],
        ['📌','📍','📎','✂️','🔍','🔎','🔒','🔓','🔑','🗝️'],
        ['💡','🔦','🕯️','💰','💴','💵','💳','📧','📞','☎️'],
        ['⏰','⌛','⏳','📅','📆','🗓️','♻️'],
    ]},
];

export function EmojiPicker({ anchorRect, onSelect, onClose }: EmojiPickerProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [activeCategory, setActiveCategory] = useState(0);

    // 点击外部或按 Escape 时关闭
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                const target = e.target as HTMLElement | null;
                if (target?.closest('[data-cmd-id="emoji"]')) return;
                onClose();
            }
        };
        document.addEventListener('keydown', handleKey);
        document.addEventListener('mousedown', handleClick);
        return () => {
            document.removeEventListener('keydown', handleKey);
            document.removeEventListener('mousedown', handleClick);
        };
    }, [onClose]);

    // 定位：显示在工具栏下方，右边缘与表情按钮对齐
    const pickerW = 300;
    const pickerH = 320;
    const toolbarWrapper = document.getElementById('toolbar-wrapper');
    const toolbarBottom = toolbarWrapper
        ? toolbarWrapper.getBoundingClientRect().bottom
        : anchorRect.bottom;
    let top = toolbarBottom + 2;
    let left = anchorRect.right - pickerW;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    if (left + pickerW > viewportW - 8) left = viewportW - pickerW - 8;
    if (left < 8) left = 8;
    if (top + pickerH > viewportH - 8) top = anchorRect.top - pickerH - 6;

    const category = EMOJI_CATEGORIES[activeCategory];

    return (
        <div
            ref={ref}
            className="emoji-picker"
            style={{ top, left, width: pickerW }}
            onMouseDown={(e) => e.preventDefault()}
        >
            {/* 分类标签栏 */}
            <div className="emoji-picker__tabs">
                {EMOJI_CATEGORIES.map((c, i) => (
                    <button
                        key={i}
                        className={`emoji-picker__tab${i === activeCategory ? ' emoji-picker__tab--active' : ''}`}
                        title={t(c.labelKey as any)}
                        onMouseDown={(e) => { e.preventDefault(); setActiveCategory(i); }}
                    >
                        {c.icon}
                    </button>
                ))}
            </div>
            {/* 分类标签文字 */}
            <div className="emoji-picker__category-label">{t(category.labelKey as any)}</div>
            {/* 表情网格 */}
            <div className="emoji-picker__grid">
                {category.rows.map((row, ri) =>
                    row.map((em) => (
                        <button
                            key={`${ri}-${em}`}
                            className="emoji-picker__btn"
                            title={em}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                onSelect(em);
                            }}
                        >
                            {em}
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}
