import re
from .languages import STOP_WORDS

GENERIC_ANCHORS = {
    'click here', 'here', 'read more', 'learn more', 'this',
    'this page', 'this post', 'this article', 'link', 'more',
    'continue', 'visit', 'see more', 'find out more', 'details'
}


def strip_markdown(md: str) -> str:
    """Strip all markdown syntax, return plain text."""
    try:
        text = md
        # Remove code blocks (``` ... ```)
        text = re.sub(r'```[\s\S]*?```', '', text)
        # Remove inline code
        text = re.sub(r'`[^`]*`', '', text)
        # Remove images entirely
        text = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', text)
        # Remove links — keep anchor text
        text = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', text)
        # Remove heading markers
        text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
        # Remove bold/italic (*** ** * ___ __ _)
        text = re.sub(r'\*{1,3}([^*]*)\*{1,3}', r'\1', text)
        text = re.sub(r'_{1,3}([^_]*)_{1,3}', r'\1', text)
        # Remove blockquotes
        text = re.sub(r'^>\s+', '', text, flags=re.MULTILINE)
        # Remove horizontal rules
        text = re.sub(r'^[-*_]{3,}\s*$', '', text, flags=re.MULTILINE)
        # Collapse whitespace
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = re.sub(r'[ \t]+', ' ', text)
        return text.strip()
    except Exception:
        return ''


def extract_headings(md: str) -> list:
    """Return [{level: int, text: str, is_question: bool}]"""
    try:
        headings = []
        for line in md.split('\n'):
            m = re.match(r'^(#{1,6})\s+(.*)', line.strip())
            if m:
                level = len(m.group(1))
                text = m.group(2).strip()
                headings.append({
                    'level': level,
                    'text': text,
                    'is_question': text.endswith('?')
                })
        return headings
    except Exception:
        return []


def tokenize(text: str, remove_stop_words: bool = True, stop_words=None) -> list:
    """Split into lowercase words. Filter stop words if requested."""
    try:
        if stop_words is None:
            stop_words = STOP_WORDS
        words = re.findall(r'\b[a-zA-Z]{2,}\b', text.lower())
        if remove_stop_words:
            words = [w for w in words if w not in stop_words]
        return words
    except Exception:
        return []


def extract_ngrams(words: list, n: int) -> list:
    """Extract n-grams (word sequences of length n) from a word list."""
    if len(words) < n:
        return []
    return [' '.join(words[i:i + n]) for i in range(len(words) - n + 1)]


def _count_syllables(word: str) -> int:
    """Estimate syllable count using vowel-cluster heuristic."""
    word = word.lower()
    count = len(re.findall(r'[aeiouy]+', word))
    # Silent trailing 'e' reduces count
    if word.endswith('e') and count > 1:
        count -= 1
    return max(1, count)
