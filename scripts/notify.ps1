# Shows one Windows notification, with its sound; a click opens AW_LINK if set.
# Values come in through the environment so nothing is spliced into code.
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$title = [Security.SecurityElement]::Escape($env:AW_TITLE)
$body = [Security.SecurityElement]::Escape($env:AW_BODY)
$launch = ''
if ($env:AW_LINK) { $launch = ' activationType="protocol" launch="' + [Security.SecurityElement]::Escape($env:AW_LINK) + '"' }

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast$launch><visual><binding template=`"ToastGeneric`"><text>$title</text><text>$body</text></binding></visual><audio src=`"ms-winsoundevent:Notification.Reminder`"/></toast>")
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show($toast)
