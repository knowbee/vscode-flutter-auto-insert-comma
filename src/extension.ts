import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {

	vscode.workspace.onDidChangeTextDocument(event => {
		autoInsertComma(event)
	})
	let disposable = vscode.commands.registerCommand('auto-insert-comma.insertComma', () => {
		// The code you place here will be executed every time your command is executed
		handleInsert(true)
	})

	context.subscriptions.push(disposable)
}

// this method is called when your extension is deactivated
export function deactivate() {}

function autoInsertComma(event: vscode.TextDocumentChangeEvent): void {
	if (!event.contentChanges[0]) {
		return
	}

	if (event.contentChanges[0].text.includes('\n')) {
		handleInsert()
	}
}

function handleInsert(isInsertToPreLine = false) {
	const editor = vscode.window.activeTextEditor
	if (!editor) {
		return
	}
	const selection = editor.selection
	if (!selection || selection.start.line === 0) {
		return
	}
	if (isInsertToPreLine && selection.start.line <= 1) {
		return
	}
	const config = vscode.workspace.getConfiguration('auto-insert-comma', editor.document.uri)
	if (!config.get<boolean>('enableAutoInsertComma', true)) {
		return
	}
	const excludedEndChars = [',', '{', '[', '(', '>', '<', '.', ';', ':', '+', '-', '*', '/', '%', '=', '?', '&', '|', '^']
	let insertPosition = selection.start.translate(0, 1)
	const line = editor.document.lineAt(isInsertToPreLine ? selection.start.translate(-1) : selection.start)
	const languageId = editor.document.languageId
	const commentSymbolIndex = line.text.indexOf(commentSymbolMap[languageId] || '//')
	if (isInsertToPreLine) {
		if (commentSymbolIndex !== -1) {
			let spaceCount = 0
			for (let i = commentSymbolIndex - 1; i > 0; i--) {
				if (line.text[i] !== ' ') {
					break
				}
				spaceCount++
			}
			const big = Math.max(commentSymbolIndex, selection.start.character)
			const small = Math.min(commentSymbolIndex, selection.start.character)
			insertPosition = selection.start.translate(-1, big - small - spaceCount)
		} else {
			insertPosition = selection.start.translate(-1, line.text.replace(/\s*$/, '').length)
		}
	}
	if (!line || !line.text.trim()) {
		return
	}

	const languages = config.get<string[]>('activationFiles', defaultSupportFiles)
	const disableLanguages = config.get<string[]>('disableFiles', [])
	if (languages.indexOf(languageId) === -1 || disableLanguages.indexOf(languageId) !== -1) {
		return
	}
	const strateFn = strategies[languageId] || defaultLineCommentFilter
	let lineStr = strateFn(line.text.trim())
	if (excludedEndChars.indexOf(lineStr[lineStr.length - 1]) !== -1) {
		return
	}

	if (commentSymbolIndex !== -1 && !isInsertToPreLine) {
		let spaceCount = 0
		for (let i = commentSymbolIndex - 1; i > 0; i--) {
			if (line.text[i] !== ' ') {
				break
			}
			spaceCount++
		}
		insertPosition = selection.start.translate(0, (commentSymbolIndex - selection.start.character - spaceCount))
	}

	let sub = isInsertToPreLine ? 2 : 1
	let lastLinePosition = selection.start.translate(-(sub))
	let lastLine = editor.document.lineAt(lastLinePosition!)
	
	while (!lastLine?.text.trim() && sub !== selection.start.line) {
		sub++
		lastLinePosition = selection.start.translate(-(sub))
		lastLine = editor.document.lineAt(lastLinePosition)
	}

	if (!lastLine?.text.trim()) {
		return
	}
	let lastLineStr = strateFn(lastLine.text.trim())
	let currentLineEndChar = lineStr[lineStr.length - 1]
	let lastLineEndChar = lastLineStr[lastLineStr.length - 1]

	if (hasSpecialStr(lineStr)) {
		return
	}

	if (lastLineEndChar === ',' || lastLineEndChar === '[' || lastLineEndChar === ']') {
		insertComma(editor, insertPosition)
	} else if (currentLineEndChar === '}') {
		const charMap = {
			'}': '{',
		}
		if (lineStr.includes(charMap[currentLineEndChar])) {
			return
		}
		const lastLP = findPosition(currentLineEndChar, charMap[currentLineEndChar], editor!, selection!, strateFn, isInsertToPreLine)
		if (lastLP) {
			lineStr = strateFn(editor.document.lineAt(lastLP).text.trim())
			if (hasSpecialStr(lineStr)) {
				return
			}
			const lastLastLinePosition = lastLP.translate(-1)
			const lll = editor.document.lineAt(lastLastLinePosition)
			const lllStr = (lll && strateFn(lll.text.trim())) || ''
			if (lllStr) {
				if (lllStr.endsWith(',')) {
					insertComma(editor, insertPosition)
				} else if (lllStr.endsWith('{')) {
					insertComma(editor, insertPosition)
				}
			}
		}
	} 
}

function insertComma(editor: vscode.TextEditor, position: vscode.Position) {
	editor.edit(editBuilder => {
		editBuilder.insert(position, ',')
	})
}

function hasSpecialStr(lineStr: string) {
	const specials = ['=', 'for(', 'for (', 'if(', 'if (', 'else {', 'class ', 'constructor(', 'constructor (']
	for (let i = 0; i < specials.length; i++) {
		if (lineStr.includes(specials[i])) {
			return true
		}
	}
	if (lineStr.includes('`')) {
		return lineStr.replace(/[^`]/g, '').length % 2 !== 0
	}
	if (lineStr.includes('void ') && lineStr.indexOf(':') === -1) {
		return true
	}
	return false
}

function findPosition(char: string, targetChar: string, editor: vscode.TextEditor, selection: vscode.Selection, commentFilter: (lineStr: string) => string, isInsertToPreLine: boolean) {
	const stack: string[] = [char]
	let lineNumber = selection.start.line!
	let sub = isInsertToPreLine ? 2 : 1
	let lastLinePosition = selection.start.translate(-(sub))
	let lastLine = editor.document.lineAt(lastLinePosition)
	let flag = false

	while (lineNumber !== sub) {
		const lineStr = commentFilter(lastLine.text.trim())
		const charIndex = lineStr.lastIndexOf(char)
		const targetCharIndex = lineStr.lastIndexOf(targetChar)
		if (targetCharIndex !== -1) {
			if (stack[stack.length - 1] !== targetChar) {
				stack.pop()
				if (stack.length === 0) {
					flag = true
					break
				}
			} else {
				stack.push(targetChar)
			}
		}
		if (charIndex !== -1) {
			stack.push(char)
		}
		sub++
		lastLinePosition = selection.start.translate(-(sub))
		lastLine = editor.document.lineAt(lastLinePosition)
	}

	if (flag) {
		return lastLinePosition
	}
}
const strategies: { [propName: string]: (lineStr: string) => string } = Object.create(null)
const commentSymbolMap: { [propName: string]: string } = Object.create(null)

function defaultLineCommentFilter(lineStr: string) {
	return lineStr.replace(/\/\/.*$/, '').trim()
}

function hashCommentFilter(lineStr: string) {
	return lineStr.replace(/#.*$/, '').trim()
}

const commentFilters1 = ['dart']
const commentFilters2 = ['dart']
const defaultSupportFiles = commentFilters1.concat(commentFilters2)

commentFilters1.forEach(key => {
	strategies[key] = defaultLineCommentFilter
	commentSymbolMap[key] = '//'
})

commentFilters2.forEach(key => {
	strategies[key] = hashCommentFilter
	commentSymbolMap[key] = '#'
})
