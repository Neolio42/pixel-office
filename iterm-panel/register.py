"""Pixel Office — iTerm2 Toolbelt panel.

Registers a webview panel in iTerm2's right sidebar that shows
active workers and approval cards from the Pixel Office server.

Usage:
    pip3 install iterm2
    python3 iterm-panel/register.py
"""

import iterm2


async def main(connection):
    await iterm2.tool.async_register_web_view_tool(
        connection,
        display_name="Pixel Office",
        identifier="com.neolio.pixeloffice",
        url="http://localhost:3000/iterm-panel",
        reveal_if_already_registered=False,
    )


iterm2.run_forever(main, retry=True)
