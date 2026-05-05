import re
from html.parser import HTMLParser

class MyHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = []
        self.in_table = False

    def handle_starttag(self, tag, attrs):
        if tag in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
            self.text.append('\n\n' + '#' * int(tag[1]) + ' ')
        elif tag == 'p':
            self.text.append('\n\n')
        elif tag == 'li':
            self.text.append('\n- ')
        elif tag == 'table':
            self.text.append('\n\n[TABLE START]\n')
            self.in_table = True
        elif tag == 'tr':
            self.text.append('\n| ')
        elif tag in ['td', 'th']:
            self.text.append(' ')
        elif tag == 'code':
            self.text.append(' `')
        elif tag == 'pre':
            self.text.append('\n```\n')

    def handle_endtag(self, tag):
        if tag in ['td', 'th']:
            self.text.append(' |')
        elif tag == 'table':
            self.text.append('\n[TABLE END]\n')
            self.in_table = False
        elif tag == 'code':
            self.text.append('` ')
        elif tag == 'pre':
            self.text.append('\n```\n')

    def handle_data(self, data):
        self.text.append(data.strip() if not self.in_table else data.replace('\n', ' '))

def extract():
    with open(r"C:\kok\Projects\AI_TEST\verifier-api\Final_Thesis_Document_Complete.html", "r", encoding="utf-8") as f:
        html = f.read()
    
    # Simple regex to strip style, script, img, etc if needed
    html = re.sub(r'<style.*?>.*?</style>', '', html, flags=re.DOTALL)
    html = re.sub(r'<script.*?>.*?</script>', '', html, flags=re.DOTALL)
    
    parser = MyHTMLParser()
    parser.feed(html)
    
    with open("extracted_thesis.md", "w", encoding="utf-8") as f:
        f.write("".join(parser.text))

if __name__ == "__main__":
    extract()
