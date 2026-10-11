"""Pure command construction regression: never loads Win32 or starts MT5."""
import ast
from pathlib import Path
import subprocess
import unittest

source = Path(__file__).parents[2] / 'optional-api-v1/packages/mt5/backend/tester-process.py'
tree = ast.parse(source.read_text())
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'metaquotes_command_line')
namespace = {'subprocess': subprocess}
exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), namespace)
command_line = namespace['metaquotes_command_line']


class MetaQuotesCommandTests(unittest.TestCase):
    def test_compiler_quotes_values_with_spaces_and_unicode(self):
        runner = r'Z:\Users\fixture\Application Support\芝麻\build'
        executable = runner + r'\.compiler\MetaEditor64.exe'
        source_file = runner + r'\Experts\Strategy.mq5'
        result = command_line(executable, [('compile', source_file), ('include', runner)])
        self.assertEqual(result, f'"{executable}" /portable /compile:"{source_file}" /include:"{runner}" /log')
        self.assertNotIn('"/compile:', result)
        self.assertNotIn('\\"', result)

    def test_tester_uses_the_same_native_parser_without_adding_compile_flags(self):
        executable = r'C:\owned\terminal64.exe'
        config = r'C:\owned\folder with spaces\pass.ini'
        self.assertEqual(command_line(executable, [('config', config)]), f'{executable} /portable /config:"{config}"')

    def test_forbidden_characters_and_options_fail_without_echoing_the_path(self):
        for bad in ['"', '\n', '\r', '\0']:
            with self.assertRaises(ValueError) as raised:
                command_line('terminal.exe', [('config', 'private-path' + bad)])
            self.assertNotIn('private-path', str(raised.exception))
        with self.assertRaises(ValueError):
            command_line('terminal.exe', [('login', 'unexpected')])


if __name__ == '__main__':
    unittest.main()
